// asktru.WeeklyReview — script.js
// Weekly Review Dashboard for NotePlan

// ============================================
// CONFIGURATION
// ============================================

var PLUGIN_ID = 'asktru.WeeklyReview';
var WINDOW_ID = 'asktru.WeeklyReview.dashboard';

function getSettings() {
  const settings = DataStore.settings || {};
  const tagStr = settings.projectTypeTags || '#project, #area';
  const excludeStr = settings.foldersToExclude || '@Archive, @Trash, @Templates, Memo, Meetings';
  return {
    projectTypeTags: tagStr.split(',').map(s => s.trim()).filter(Boolean),
    foldersToExclude: excludeStr.split(',').map(s => s.trim()).filter(Boolean),
    reviewMentionStr: settings.reviewMentionStr || '@review',
    reviewedMentionStr: settings.reviewedMentionStr || '@reviewed',
    appendCompletionDate: settings.appendCompletionDate !== false && settings.appendCompletionDate !== 'false',
  };
}

// ============================================
// DATE UTILITIES
// ============================================

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return null;
  const d1 = new Date(dateStr1 + 'T00:00:00');
  const d2 = new Date(dateStr2 + 'T00:00:00');
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

/**
 * Parse interval like "1w", "2w", "1m", "1q" into days
 */
function intervalToDays(interval) {
  if (!interval) return 7; // default weekly
  const match = interval.match(/^(\d+)([dwmqy])$/i);
  if (!match) return 7;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'd': return num;
    case 'w': return num * 7;
    case 'm': return num * 30;
    case 'q': return num * 91;
    case 'y': return num * 365;
    default: return 7;
  }
}

/**
 * Add interval to a date string, return new date string
 */
function addIntervalToDate(dateStr, interval) {
  if (!dateStr || !interval) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const days = intervalToDays(interval);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a date string for display: "Mar 16" or "Mar 16, 2025"
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Format days as human-readable relative time
 */
function formatDaysRelative(days) {
  if (days === null || days === undefined || isNaN(days)) return 'No review date';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `Due in ${days}d`;
  if (days <= 30) return `Due in ${Math.ceil(days / 7)}w`;
  return `Due in ${Math.ceil(days / 30)}mo`;
}

/**
 * Format an interval code for display
 */
function formatInterval(interval) {
  if (!interval) return '';
  const match = interval.match(/^(\d+)([dwmqy])$/i);
  if (!match) return interval;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const labels = { d: 'day', w: 'week', m: 'month', q: 'quarter', y: 'year' };
  const label = labels[unit] || unit;
  return `Every ${num} ${label}${num > 1 ? 's' : ''}`;
}

// ============================================
// NOTE SCANNING & PROJECT DATA
// ============================================

/**
 * URI encode for safe HTML attribute embedding
 */
function encSafe(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function decSafe(str) {
  try { return decodeURIComponent(str); } catch (e) { return str; }
}

/**
 * Get value from @mention(value) in a mentions array
 */
// ============================================
// FRONTMATTER PARSING
// ============================================

function parseFrontmatter(content) {
  if (!content) return { frontmatter: {}, body: content || '' };
  var lines = content.split('\n');
  if (lines[0].trim() !== '---') return { frontmatter: {}, body: content };
  var endIdx = -1;
  for (var i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return { frontmatter: {}, body: content };
  var fm = {};
  for (var j = 1; j < endIdx; j++) {
    var line = lines[j];
    var colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    var key = line.substring(0, colonIdx).trim();
    var val = line.substring(colonIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.substring(1, val.length - 1);
    }
    fm[key] = val;
  }
  return { frontmatter: fm, body: lines.slice(endIdx + 1).join('\n') };
}

function setFrontmatterKey(note, key, value) {
  var content = note.content || '';
  var lines = content.split('\n');
  if (lines[0].trim() === '---') {
    var endIdx = -1;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { endIdx = i; break; }
    }
    if (endIdx > 0) {
      var found = false;
      for (var j = 1; j < endIdx; j++) {
        if (lines[j].match(new RegExp('^' + key + '\\s*:'))) {
          lines[j] = key + ': ' + value;
          found = true;
          break;
        }
      }
      if (!found) {
        lines.splice(endIdx, 0, key + ': ' + value);
      }
      note.content = lines.join('\n');
      return;
    }
  }
  // No frontmatter — create one
  lines.unshift('---', key + ': ' + value, '---');
  note.content = lines.join('\n');
}

function removeFrontmatterKey(content, key) {
  var lines = content.split('\n');
  if (lines[0].trim() !== '---') return content;
  var endIdx = -1;
  for (var i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return content;
  for (var j = 1; j < endIdx; j++) {
    if (lines[j].match(new RegExp('^' + key + '\\s*:'))) {
      lines.splice(j, 1);
      endIdx--;
      break;
    }
  }
  // Remove empty frontmatter
  var hasContent = false;
  for (var k = 1; k < endIdx; k++) {
    if (lines[k].trim() !== '') { hasContent = true; break; }
  }
  if (!hasContent) {
    lines.splice(0, endIdx + 1);
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  }
  return lines.join('\n');
}

// ============================================
// MENTION UTILITIES
// ============================================

function getMentionValue(mentions, key) {
  if (!mentions || !key) return null;
  const prefix = key + '(';
  for (const m of mentions) {
    if (m.startsWith(prefix) && m.endsWith(')')) {
      return m.slice(prefix.length, -1);
    }
  }
  return null;
}

/**
 * Count tasks in a note's paragraphs
 * Returns { open, done, cancelled, total }
 */
function countTasks(note) {
  const paras = note.paragraphs || [];
  let open = 0, done = 0, cancelled = 0;
  for (const p of paras) {
    const t = p.type;
    if (t === 'open') open++;
    else if (t === 'done') done++;
    else if (t === 'cancelled') cancelled++;
  }
  // total excludes cancelled per user request
  const total = open + done;
  return { open, done, cancelled, total };
}

/**
 * Determine which tag matched this note (#project or #area)
 */
function getMatchedTag(note, tags) {
  const noteHashtags = note.hashtags || [];
  for (const tag of tags) {
    const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
    if (noteHashtags.some(h => h === cleanTag || h === tag)) {
      return tag.startsWith('#') ? tag : '#' + tag;
    }
  }
  return null;
}

/**
 * Scan all project notes and build project data
 */
function scanProjects() {
  const config = getSettings();
  const allNotes = DataStore.projectNotes;
  const projects = [];

  for (const note of allNotes) {
    // Check folder exclusions
    const filename = note.filename || '';
    const shouldExclude = config.foldersToExclude.some(folder => {
      return filename.startsWith(folder + '/') || filename.startsWith(folder);
    });
    if (shouldExclude) continue;

    // Check frontmatter first, then fall back to hashtags
    const noteContent = note.content || '';
    const fm = parseFrontmatter(noteContent).frontmatter;
    const hasFmType = fm.type === 'project' || fm.type === 'area';

    const matchedTag = hasFmType ? (fm.type === 'area' ? '#area' : '#project') : getMatchedTag(note, config.projectTypeTags);
    if (!matchedTag) continue;

    const mentions = note.mentions || [];
    const hashtags = note.hashtags || [];
    const useFrontmatter = hasFmType; // prefer frontmatter if type is set there

    // Parse review metadata — frontmatter takes priority over mentions
    const reviewInterval = (useFrontmatter && fm.review) ? fm.review : getMentionValue(mentions, config.reviewMentionStr);
    const reviewedDate = (useFrontmatter && fm.reviewed) ? fm.reviewed : getMentionValue(mentions, config.reviewedMentionStr);
    const startDate = fm.start || getMentionValue(mentions, '@start');
    const dueDate = fm.due || getMentionValue(mentions, '@due');
    const completedDate = fm.completed || getMentionValue(mentions, '@completed');
    const cancelledDate = fm.cancelled || getMentionValue(mentions, '@cancelled');

    // Calculate next review date and days until due
    const today = getTodayStr();
    let nextReviewDate = null;
    let daysUntilReview = null;

    if (completedDate || cancelledDate) {
      // No review needed for completed/cancelled
      daysUntilReview = null;
    } else if (reviewInterval) {
      if (reviewedDate) {
        nextReviewDate = addIntervalToDate(reviewedDate, reviewInterval);
        daysUntilReview = daysBetween(today, nextReviewDate);
      } else {
        // Never reviewed — due immediately
        daysUntilReview = 0;
        nextReviewDate = today;
      }
    }

    // Determine paused state
    const isPaused = hashtags.includes('paused') || hashtags.includes('#paused');

    // Determine review status
    let reviewStatus = 'no-review';
    if (completedDate) reviewStatus = 'completed';
    else if (cancelledDate) reviewStatus = 'cancelled';
    else if (isPaused) reviewStatus = 'paused';
    else if (daysUntilReview !== null) {
      if (daysUntilReview <= 0) reviewStatus = 'overdue';
      else if (daysUntilReview <= 2) reviewStatus = 'due';
      else reviewStatus = 'fresh';
    }

    // Count tasks
    const tasks = countTasks(note);

    // Get folder for grouping
    const folderParts = filename.split('/');
    const folder = folderParts.length > 1 ? folderParts.slice(0, -1).join('/') : '';

    // Get clean title
    const title = note.title || filename.replace(/\.md$|\.txt$/, '');

    projects.push({
      filename,
      title,
      folder,
      tag: matchedTag,
      tagType: matchedTag.includes('area') ? 'area' : 'project',
      reviewInterval,
      reviewedDate,
      nextReviewDate,
      daysUntilReview,
      reviewStatus,
      startDate,
      dueDate,
      completedDate,
      cancelledDate,
      isPaused,
      tasks,
    });
  }

  // Sort: overdue first (most overdue at top), then due, then fresh, then others
  projects.sort((a, b) => {
    const statusOrder = { overdue: 0, due: 1, fresh: 2, 'no-review': 3, paused: 4, completed: 5, cancelled: 6 };
    const sa = statusOrder[a.reviewStatus] ?? 9;
    const sb = statusOrder[b.reviewStatus] ?? 9;
    if (sa !== sb) return sa - sb;
    // Within same status, sort by days until review (most overdue first)
    const da = a.daysUntilReview ?? 9999;
    const db = b.daysUntilReview ?? 9999;
    return da - db;
  });

  return projects;
}

// ============================================
// HTML GENERATION
// ============================================

/**
 * Escape HTML entities
 */
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render basic markdown to HTML.
 * Supports: **bold**, *italic*, `inline code`, ~~strikethrough~~, [links](url), ==highlight==
 */
function renderMarkdown(str) {
  if (!str) return '';
  var s = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Wiki links: [[Note Name]]
  s = s.replace(/\[\[([^\]]+)\]\]/g, function(match, noteName) {
    var encoded = encodeURIComponent(noteName);
    var url = 'noteplan://x-callback-url/openNote?noteTitle=' + encoded + '&amp;splitView=yes&amp;reuseSplitView=yes';
    return '<a class="wr-md-link" href="' + url + '" title="' + noteName.replace(/"/g, '&quot;') + '">' + noteName + '</a>';
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="wr-md-link" href="$2" title="$2">$1</a>');
  s = s.replace(/`([^`]+)`/g, '<code class="wr-md-code">$1</code>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=]+)==/g, '<mark class="wr-md-highlight">$1</mark>');
  s = s.replace(/(^|[\s(])#([\w][\w/-]*)/g, '$1<span class="wr-tag">#$2</span>');
  s = s.replace(/(^|[\s(])@([\w][\w/-]*(?:\([^)]*\))?)/g, '$1<span class="wr-mention">@$2</span>');
  // Inline comments: /* ... */
  s = s.replace(/\/\*([^*]*(?:\*(?!\/)[^*]*)*)\*\//g, '<span class="wr-comment">/*$1*/</span>');
  // End-line comments: // ... (but not URLs like https://)
  s = s.replace(/(^|[^:])\/\/\s(.*)$/g, '$1<span class="wr-comment">// $2</span>');
  return s;
}

/**
 * Generate theme CSS from NotePlan
 */
/**
 * Convert NotePlan's #AARRGGBB hex to standard #RRGGBBAA (or pass through #RRGGBB)
 */
function npColor(c) {
  if (!c) return null;
  if (c.match && c.match(/^#[0-9A-Fa-f]{8}$/)) {
    return '#' + c.slice(3, 9) + c.slice(1, 3);
  }
  return c;
}

function isLightTheme() {
  try {
    const theme = Editor.currentTheme;
    if (!theme) return false;
    if (theme.mode === 'light') return true;
    if (theme.mode === 'dark') return false;
    const vals = theme.values || {};
    const bg = npColor((vals.editor || {}).backgroundColor);
    if (bg) {
      const m = bg.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
      if (m) {
        const lum = (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000;
        return lum > 140;
      }
    }
  } catch (e) {}
  return false;
}

function getThemeCSS() {
  try {
    const theme = Editor.currentTheme;
    if (!theme) return '';
    const vals = theme.values || {};
    const editor = vals.editor || {};
    const styles = [];
    const bg = npColor(editor.backgroundColor);
    const altBg = npColor(editor.altBackgroundColor);
    const text = npColor(editor.textColor);
    const tint = npColor(editor.tintColor);
    if (bg) styles.push('--bg-main-color: ' + bg);
    if (altBg) styles.push('--bg-alt-color: ' + altBg);
    if (text) styles.push('--fg-main-color: ' + text);
    if (tint) styles.push('--tint-color: ' + tint);
    if (styles.length > 0) {
      return `:root { ${styles.join('; ')}; }`;
    }
  } catch (e) {
    // Theme access may fail; fall back to defaults
  }
  return '';
}

/**
 * Build the progress bar HTML for a project
 */
function buildProgressBar(tasks) {
  if (tasks.total === 0) {
    return '<div class="wr-progress-wrap"><div class="wr-progress-bar"></div><span class="wr-progress-label">No tasks</span></div>';
  }
  const pctDone = Math.round((tasks.done / tasks.total) * 100);
  const pctOpen = 100 - pctDone;
  return `<div class="wr-progress-wrap">
    <div class="wr-progress-bar">
      <div class="wr-progress-fill done" style="width:${pctDone}%"></div>
      <div class="wr-progress-fill open" style="width:${pctOpen}%"></div>
    </div>
    <span class="wr-progress-label">${tasks.done}/${tasks.total} done</span>
  </div>`;
}

/**
 * Build the review status pill
 */
function buildReviewPill(project) {
  const s = project.reviewStatus;
  if (s === 'completed') return '<span class="wr-review-pill fresh"><i class="fa-solid fa-circle-check"></i> Completed</span>';
  if (s === 'cancelled') return '<span class="wr-review-pill no-review"><i class="fa-solid fa-circle-xmark"></i> Cancelled</span>';
  if (s === 'paused') return '<span class="wr-review-pill no-review"><i class="fa-solid fa-circle-pause"></i> Paused</span>';
  if (s === 'overdue') {
    let label;
    if (!project.reviewedDate && project.daysUntilReview === 0) {
      label = 'Never reviewed';
    } else if (project.daysUntilReview === 0) {
      label = 'Review due';
    } else {
      label = `Review ${Math.abs(project.daysUntilReview)}d overdue`;
    }
    return `<span class="wr-review-pill overdue"><i class="fa-solid fa-clock"></i> ${esc(label)}</span>`;
  }
  if (s === 'due') {
    const label = project.daysUntilReview === 1 ? 'Review tomorrow' : `Review in ${project.daysUntilReview}d`;
    return `<span class="wr-review-pill due"><i class="fa-solid fa-clock"></i> ${esc(label)}</span>`;
  }
  if (s === 'fresh') {
    const days = project.daysUntilReview;
    let label;
    if (days <= 7) label = `Review in ${days}d`;
    else if (days <= 30) label = `Review in ${Math.ceil(days / 7)}w`;
    else label = `Review in ${Math.ceil(days / 30)}mo`;
    return `<span class="wr-review-pill fresh"><i class="fa-solid fa-check"></i> ${esc(label)}</span>`;
  }
  return '<span class="wr-review-pill no-review">No schedule</span>';
}

/**
 * Build a single project card
 */
function buildCard(project) {
  const encodedFilename = encSafe(project.filename);
  const isActive = !project.completedDate && !project.cancelledDate && !project.isPaused;

  let metaLeft = '';
  if (project.folder) {
    metaLeft += `<span class="wr-card-meta-item wr-card-folder"><i class="fa-solid fa-folder"></i> ${esc(project.folder)}</span>`;
  }
  let metaRight = '';
  if (project.reviewInterval) {
    metaRight += `<span class="wr-card-meta-item"><i class="fa-solid fa-arrows-rotate"></i> ${esc(formatInterval(project.reviewInterval))}</span>`;
  }
  if (project.reviewedDate) {
    metaRight += `<span class="wr-card-meta-item"><i class="fa-regular fa-calendar-check"></i> ${esc(formatDate(project.reviewedDate))}</span>`;
  }
  if (project.startDate) {
    metaRight += `<span class="wr-card-meta-item"><i class="fa-solid fa-play"></i> Started ${esc(formatDate(project.startDate))}</span>`;
  }
  if (project.dueDate) {
    metaRight += `<span class="wr-card-meta-item"><i class="fa-solid fa-flag"></i> Due ${esc(formatDate(project.dueDate))}</span>`;
  }
  const metaItems = metaLeft + (metaRight ? '<span class="wr-card-meta-right">' + metaRight + '</span>' : '');

  const actionButtons = isActive
    ? `<button class="wr-card-action-btn review-btn" data-action="markReviewed" data-tooltip="Mark reviewed"><i class="fa-solid fa-check"></i></button>
       <button class="wr-card-action-btn open-btn" data-action="openNote" data-tooltip="Open note"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`
    : `<button class="wr-card-action-btn open-btn" data-action="openNote" data-tooltip="Open note"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`;

  return `<div class="wr-card" data-encoded-filename="${encodedFilename}" data-status="${project.reviewStatus}" data-type="${project.tagType}">
    <div class="wr-card-stripe ${project.reviewStatus}"></div>
    <div class="wr-card-body">
      <div class="wr-card-top">
        <span class="wr-card-expand-chevron"><i class="fa-solid fa-chevron-right"></i></span>
        <span class="wr-card-title">${esc(project.title)}</span>
        <span class="wr-card-tag ${project.tagType}">${esc(project.tagType)}</span>
        ${buildReviewPill(project)}
      </div>
      <div class="wr-card-meta">${metaItems}</div>
      ${project.tasks.total > 0 ? buildProgressBar(project.tasks) : ''}
    </div>
    <div class="wr-card-actions">
      ${actionButtons}
    </div>
  </div>`;
}

/**
 * Build the summary stats cards
 */
/**
 * Build the unified filter bar: review status (left) + type (right)
 */
function buildFilterBar(projects) {
  const active = projects.filter(p => !p.completedDate && !p.cancelledDate && !p.isPaused);
  const overdue = active.filter(p => p.reviewStatus === 'overdue').length;
  const reviewSoon = active.filter(p => p.reviewStatus === 'due').length;
  const onTrack = active.filter(p => p.reviewStatus === 'fresh').length;
  const areas = projects.filter(p => p.tagType === 'area').length;
  const projectCount = projects.filter(p => p.tagType === 'project').length;

  return `<div class="wr-filter-bar">
    <div class="wr-filter-group">
      <button class="wr-filter-btn active" data-filter="all">All <span class="wr-filter-count">${active.length}</span></button>
      <button class="wr-filter-btn" data-filter="overdue">Needs Review <span class="wr-filter-count wr-count-overdue">${overdue}</span></button>
      <button class="wr-filter-btn" data-filter="due">Review Soon <span class="wr-filter-count wr-count-due">${reviewSoon}</span></button>
      <button class="wr-filter-btn" data-filter="fresh">On Track <span class="wr-filter-count wr-count-fresh">${onTrack}</span></button>
    </div>
    <div class="wr-filter-group wr-filter-type">
      <button class="wr-filter-btn active" data-type-filter="all">All</button>
      <button class="wr-filter-btn" data-type-filter="project">Projects <span class="wr-filter-count">${projectCount}</span></button>
      <button class="wr-filter-btn" data-type-filter="area">Areas <span class="wr-filter-count">${areas}</span></button>
    </div>
  </div>`;
}

/**
 * Build the full HTML page body content
 */
function buildDashboardHTML(projects) {
  let html = '';

  html += buildFilterBar(projects);
  html += '<div class="wr-body">';

  // Active items needing review
  const active = projects.filter(p => !p.completedDate && !p.cancelledDate && !p.isPaused);
  const needsReview = active.filter(p => p.reviewStatus === 'overdue');
  const reviewSoon = active.filter(p => p.reviewStatus === 'due');
  const onTrack = active.filter(p => p.reviewStatus === 'fresh');
  const noSchedule = active.filter(p => p.reviewStatus === 'no-review');
  const inactive = projects.filter(p => p.completedDate || p.cancelledDate || p.isPaused);

  if (needsReview.length > 0) {
    html += `<div class="wr-section" data-section="needs-review">
      <div class="wr-section-header">
        <div class="wr-section-icon area"><i class="fa-solid fa-clock"></i></div>
        <span class="wr-section-title">Needs Review</span>
        <span class="wr-section-count">${needsReview.length} items</span>
      </div>
      <div class="wr-cards">${needsReview.map(buildCard).join('')}</div>
    </div>`;
  }

  if (reviewSoon.length > 0) {
    html += `<div class="wr-section" data-section="review-soon">
      <div class="wr-section-header">
        <div class="wr-section-icon due"><i class="fa-solid fa-calendar-clock"></i></div>
        <span class="wr-section-title">Review Soon</span>
        <span class="wr-section-count">${reviewSoon.length} items</span>
      </div>
      <div class="wr-cards">${reviewSoon.map(buildCard).join('')}</div>
    </div>`;
  }

  if (onTrack.length > 0) {
    html += `<div class="wr-section" data-section="on-track">
      <div class="wr-section-header">
        <div class="wr-section-icon project"><i class="fa-solid fa-check"></i></div>
        <span class="wr-section-title">On Track</span>
        <span class="wr-section-count">${onTrack.length} items</span>
      </div>
      <div class="wr-cards">${onTrack.map(buildCard).join('')}</div>
    </div>`;
  }

  if (noSchedule.length > 0) {
    html += `<div class="wr-section" data-section="no-schedule">
      <div class="wr-section-header">
        <div class="wr-section-icon area"><i class="fa-solid fa-minus"></i></div>
        <span class="wr-section-title">No Review Schedule</span>
        <span class="wr-section-count">${noSchedule.length} items</span>
      </div>
      <div class="wr-cards">${noSchedule.map(buildCard).join('')}</div>
    </div>`;
  }

  if (inactive.length > 0) {
    html += `<div class="wr-section" data-section="inactive">
      <div class="wr-section-header">
        <div class="wr-section-icon area"><i class="fa-solid fa-archive"></i></div>
        <span class="wr-section-title">Inactive</span>
        <span class="wr-section-count">${inactive.length} items</span>
      </div>
      <div class="wr-cards">${inactive.map(buildCard).join('')}</div>
    </div>`;
  }

  if (projects.length === 0) {
    html += `<div class="wr-empty">
      <div class="wr-empty-icon"><i class="fa-solid fa-folder-open"></i></div>
      <div class="wr-empty-title">No projects or areas found</div>
      <div class="wr-empty-desc">Add #project or #area tags to your notes to see them here.</div>
    </div>`;
  }

  html += '</div>'; // .wr-body

  return html;
}

/**
 * All CSS embedded inline (like Linear Calendar pattern) for reliable loading
 */
function npColorToCSS(hex) {
  if (!hex || typeof hex !== 'string') return null;
  hex = hex.replace(/^#/, '');
  if (hex.length === 8) {
    var a = parseInt(hex.substring(0, 2), 16) / 255;
    var r = parseInt(hex.substring(2, 4), 16);
    var g = parseInt(hex.substring(4, 6), 16);
    var b = parseInt(hex.substring(6, 8), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(2) + ')';
  }
  if (hex.length === 6) return '#' + hex;
  return null;
}

function getThemePriorityColors() {
  var defaults = {
    pri3: { bg: 'rgba(255,85,85,0.67)', color: '#FFB5B5' },
    pri2: { bg: 'rgba(255,85,85,0.47)', color: '#FFCCCC' },
    pri1: { bg: 'rgba(255,85,85,0.27)', color: '#FFDBBE' },
  };
  try {
    if (typeof Editor === 'undefined' || !Editor.currentTheme || !Editor.currentTheme.values) return defaults;
    var styles = Editor.currentTheme.values.styles || {};
    var f1 = styles['flagged-1'], f2 = styles['flagged-2'], f3 = styles['flagged-3'];
    return {
      pri1: { bg: (f1 && f1.backgroundColor) ? npColorToCSS(f1.backgroundColor) || defaults.pri1.bg : defaults.pri1.bg, color: (f1 && f1.color) ? npColorToCSS(f1.color) || defaults.pri1.color : defaults.pri1.color },
      pri2: { bg: (f2 && f2.backgroundColor) ? npColorToCSS(f2.backgroundColor) || defaults.pri2.bg : defaults.pri2.bg, color: (f2 && f2.color) ? npColorToCSS(f2.color) || defaults.pri2.color : defaults.pri2.color },
      pri3: { bg: (f3 && f3.backgroundColor) ? npColorToCSS(f3.backgroundColor) || defaults.pri3.bg : defaults.pri3.bg, color: (f3 && f3.color) ? npColorToCSS(f3.color) || defaults.pri3.color : defaults.pri3.color },
    };
  } catch (e) { return defaults; }
}

function priCSS(className) {
  var c = getThemePriorityColors();
  return '.' + className + '.p3 { background: ' + c.pri3.bg + '; color: ' + c.pri3.color + '; }\n' +
         '.' + className + '.p2 { background: ' + c.pri2.bg + '; color: ' + c.pri2.color + '; }\n' +
         '.' + className + '.p1 { background: ' + c.pri1.bg + '; color: ' + c.pri1.color + '; }\n';
}

function getInlineCSS() {
  return `
:root {
  --wr-bg: var(--bg-main-color, #1a1a2e);
  --wr-bg-card: var(--bg-alt-color, #16213e);
  --wr-bg-elevated: color-mix(in srgb, var(--wr-bg-card) 85%, white 15%);
  --wr-text: var(--fg-main-color, #e0e0e0);
  --wr-text-muted: color-mix(in srgb, var(--wr-text) 55%, transparent);
  --wr-text-faint: color-mix(in srgb, var(--wr-text) 35%, transparent);
  --wr-accent: var(--tint-color, #7C3AED);
  --wr-accent-soft: color-mix(in srgb, var(--wr-accent) 15%, transparent);
  --wr-border: color-mix(in srgb, var(--wr-text) 10%, transparent);
  --wr-border-strong: color-mix(in srgb, var(--wr-text) 18%, transparent);
  --wr-green: #10B981;
  --wr-green-soft: color-mix(in srgb, #10B981 12%, transparent);
  --wr-yellow: #F59E0B;
  --wr-yellow-soft: color-mix(in srgb, #F59E0B 12%, transparent);
  --wr-orange: #F97316;
  --wr-red: #EF4444;
  --wr-red-soft: color-mix(in srgb, #EF4444 12%, transparent);
  --wr-blue: #3B82F6;
  --wr-blue-soft: color-mix(in srgb, #3B82F6 12%, transparent);
  --wr-purple: #8B5CF6;
  --wr-purple-soft: color-mix(in srgb, #8B5CF6 12%, transparent);
  --wr-gray: color-mix(in srgb, var(--wr-text) 40%, transparent);
  --wr-radius: 10px;
  --wr-radius-sm: 6px;
  --wr-radius-xs: 4px;
  --wr-gap: 10px;
  --wr-pad: 14px;
}
/* ---- Light theme overrides ---- */
[data-theme="light"] {
  --wr-bg-elevated: color-mix(in srgb, var(--wr-bg-card) 92%, black 8%);
  --wr-text-muted: color-mix(in srgb, var(--wr-text) 60%, transparent);
  --wr-text-faint: color-mix(in srgb, var(--wr-text) 40%, transparent);
  --wr-border: color-mix(in srgb, var(--wr-text) 12%, transparent);
  --wr-border-strong: color-mix(in srgb, var(--wr-text) 22%, transparent);
  --wr-green-soft: color-mix(in srgb, #10B981 10%, white);
  --wr-yellow-soft: color-mix(in srgb, #F59E0B 10%, white);
  --wr-red-soft: color-mix(in srgb, #EF4444 10%, white);
  --wr-blue-soft: color-mix(in srgb, #3B82F6 10%, white);
  --wr-purple-soft: color-mix(in srgb, #8B5CF6 10%, white);
  --wr-accent-soft: color-mix(in srgb, var(--wr-accent) 12%, white);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  background: var(--wr-bg);
  color: var(--wr-text);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
.wr-filter-bar {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 16px; flex-wrap: wrap;
  background: color-mix(in srgb, var(--wr-bg) 92%, transparent);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--wr-border);
}
.wr-filter-group { display: flex; gap: 4px; align-items: center; }
.wr-filter-btn {
  padding: 5px 12px; font-size: 12px; font-weight: 500;
  border-radius: 100px; border: none; background: transparent;
  color: var(--wr-text-muted); cursor: pointer;
  transition: all 0.15s ease; white-space: nowrap;
}
.wr-filter-btn:hover { background: var(--wr-border); color: var(--wr-text); }
.wr-filter-btn.active { background: var(--wr-accent-soft); color: var(--wr-accent); font-weight: 600; }
.wr-filter-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; margin-left: 4px;
  font-size: 10px; font-weight: 700; border-radius: 100px;
  background: var(--wr-border); font-variant-numeric: tabular-nums;
}
.wr-filter-btn.active .wr-filter-count { background: var(--wr-accent); color: #fff; }
.wr-count-overdue { color: var(--wr-red); }
.wr-count-due { color: var(--wr-yellow); }
.wr-count-fresh { color: var(--wr-green); }
.wr-body { padding: 16px 16px 40px; }
.wr-section { margin-bottom: 24px; }
.wr-section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; }
.wr-section-icon {
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--wr-radius-xs); font-size: 11px;
}
.wr-section-icon.area { background: var(--wr-blue-soft); color: var(--wr-blue); }
.wr-section-icon.project { background: var(--wr-purple-soft); color: var(--wr-purple); }
.wr-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--wr-text-muted); }
.wr-section-count { font-size: 11px; color: var(--wr-text-faint); font-weight: 500; }
.wr-cards { display: flex; flex-direction: column; gap: var(--wr-gap); }
.wr-card {
  display: grid; grid-template-columns: 6px 1fr auto; gap: 0;
  background: var(--wr-bg-card); border: 1px solid var(--wr-border);
  border-radius: var(--wr-radius); overflow: hidden;
  transition: all 0.15s ease; cursor: default;
}
.wr-card:hover { border-color: var(--wr-border-strong); box-shadow: 0 2px 8px color-mix(in srgb, black 8%, transparent); }
.wr-card-stripe { border-radius: 0; }
.wr-card-stripe.overdue { background: var(--wr-red); }
.wr-card-stripe.due { background: var(--wr-yellow); }
.wr-card-stripe.fresh { background: var(--wr-green); }
.wr-card-stripe.no-review { background: var(--wr-gray); }
.wr-card-stripe.completed { background: var(--wr-blue); }
.wr-card-stripe.cancelled { background: var(--wr-text-faint); }
.wr-card-stripe.paused { background: var(--wr-text-faint); }
.wr-card-body { padding: 11px var(--wr-pad); min-width: 0; }
.wr-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.wr-card-title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; cursor: pointer; }
.wr-card-title:hover { color: var(--wr-accent); }
.wr-card-tag {
  display: inline-flex; align-items: center; padding: 1px 7px;
  font-size: 10px; font-weight: 600; border-radius: 100px;
  flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.04em;
}
.wr-card-tag.area { background: var(--wr-blue-soft); color: var(--wr-blue); }
.wr-card-tag.project { background: var(--wr-purple-soft); color: var(--wr-purple); }
.wr-card-meta { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--wr-text-muted); }
.wr-card-meta-item { display: flex; align-items: center; gap: 4px; white-space: nowrap; min-width: 0; }
.wr-card-meta-item i { font-size: 10px; opacity: 0.7; flex-shrink: 0; }
.wr-card-folder { color: var(--wr-text-faint); font-size: 11px; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.wr-card-meta-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin-left: auto; }
.wr-progress-wrap { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.wr-progress-bar { flex: 1; height: 6px; background: var(--wr-border); border-radius: 100px; overflow: hidden; display: flex; }
.wr-progress-fill { height: 100%; border-radius: 100px; transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1); }
.wr-progress-fill.done { background: var(--wr-green); }
.wr-progress-fill.open { background: color-mix(in srgb, var(--wr-text) 18%, transparent); border-radius: 0; }
.wr-progress-label { font-size: 11px; color: var(--wr-text-muted); font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 60px; text-align: right; }
.wr-card-actions { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 10px; gap: 4px; border-left: 1px solid var(--wr-border); }
.wr-card-action-btn {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--wr-radius-sm); border: none; background: transparent;
  color: var(--wr-text-muted); cursor: pointer; font-size: 13px; transition: all 0.15s ease;
}
.wr-card-action-btn:hover { background: var(--wr-border); color: var(--wr-text); }
.wr-card-action-btn.review-btn:hover { background: var(--wr-green-soft); color: var(--wr-green); }
.wr-card-action-btn.open-btn:hover { background: var(--wr-accent-soft); color: var(--wr-accent); }
.wr-review-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; font-size: 10px; font-weight: 600;
  border-radius: 100px; white-space: nowrap;
}
.wr-review-pill.overdue { background: var(--wr-red-soft); color: var(--wr-red); }
.wr-review-pill.due { background: var(--wr-yellow-soft); color: var(--wr-yellow); }
.wr-review-pill.fresh { background: var(--wr-green-soft); color: var(--wr-green); }
.wr-review-pill.no-review { background: var(--wr-border); color: var(--wr-text-faint); }
.wr-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 20px; text-align: center; }
.wr-empty-icon { font-size: 36px; color: var(--wr-text-faint); margin-bottom: 12px; }
.wr-empty-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.wr-empty-desc { font-size: 12px; color: var(--wr-text-muted); }
[data-tooltip] { position: relative; }
[data-tooltip]:hover::after {
  content: attr(data-tooltip); position: absolute; top: calc(100% + 6px); right: 0;
  padding: 4px 8px; font-size: 11px; font-weight: 500;
  white-space: nowrap; background: var(--wr-bg-elevated); color: var(--wr-text);
  border: 1px solid var(--wr-border-strong); border-radius: var(--wr-radius-xs);
  z-index: 500; pointer-events: none;
}
.wr-card-actions { overflow: visible; }
.wr-card-actions [data-tooltip]:hover::after { right: 100%; bottom: auto; top: 50%; transform: translateY(-50%); margin-right: 6px; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
.wr-card { animation: fadeIn 0.25s ease both; }
.wr-cards .wr-card:nth-child(1) { animation-delay: 0.02s; }
.wr-cards .wr-card:nth-child(2) { animation-delay: 0.04s; }
.wr-cards .wr-card:nth-child(3) { animation-delay: 0.06s; }
.wr-cards .wr-card:nth-child(4) { animation-delay: 0.08s; }
.wr-cards .wr-card:nth-child(5) { animation-delay: 0.10s; }
.wr-cards .wr-card:nth-child(6) { animation-delay: 0.12s; }
.wr-cards .wr-card:nth-child(7) { animation-delay: 0.14s; }
.wr-cards .wr-card:nth-child(8) { animation-delay: 0.16s; }
.wr-cards .wr-card:nth-child(9) { animation-delay: 0.18s; }
.wr-cards .wr-card:nth-child(10) { animation-delay: 0.20s; }
.wr-toast {
  position: fixed; bottom: 20px; right: 20px;
  padding: 10px 16px; font-size: 12px; font-weight: 500;
  background: var(--wr-green); color: #fff;
  border-radius: var(--wr-radius-sm);
  box-shadow: 0 4px 16px color-mix(in srgb, black 20%, transparent);
  z-index: 1000;
  animation: toastIn 0.3s ease, toastOut 0.3s ease 2.5s forwards;
}
@keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes toastOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--wr-border-strong); border-radius: 100px; }
::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--wr-text) 30%, transparent); }

/* ---- Expand/Collapse ---- */
.wr-card { cursor: pointer; }
.wr-card.expanded { border-color: var(--wr-accent); }
.wr-card-expand-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; font-size: 10px; color: var(--wr-text-faint);
  transition: transform 0.2s ease; flex-shrink: 0;
}
.wr-card.expanded .wr-card-expand-chevron { transform: rotate(90deg); color: var(--wr-accent); }
.wr-card-expanded {
  grid-column: 1 / -1;
  border-top: 1px solid var(--wr-border);
  padding: 8px 12px 12px;
  overflow: visible;
}
.wr-card-expanded.loading { display: flex; align-items: center; justify-content: center; padding: 20px; color: var(--wr-text-muted); font-size: 12px; }

/* ---- Task Sections ---- */
.wr-tsec-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 0 4px; font-size: 12px; font-weight: 600;
  color: var(--wr-text-muted); border-bottom: 1px solid var(--wr-border);
  margin-bottom: 4px; margin-top: 4px;
}
.wr-tsec-header:first-child { margin-top: 0; }

/* ---- Task Items ---- */
.wr-task {
  display: flex; align-items: baseline; gap: 6px;
  padding: 4px 4px; border-radius: var(--wr-radius-xs);
  transition: background 0.1s ease; position: relative;
}
.wr-task:hover { background: var(--wr-border); }
.wr-task.indent-1 { padding-left: 20px; }
.wr-task.indent-2 { padding-left: 36px; }
.wr-task.indent-3 { padding-left: 52px; }
.wr-task-cb {
  flex-shrink: 0; position: relative; top: 2px;
  cursor: pointer; font-size: 14px; transition: all 0.15s ease;
}
.wr-task-cb.open { color: var(--wr-text-faint); }
.wr-task-cb.open:hover { color: var(--wr-green); }
.wr-task-cb.done { color: var(--wr-green); }
.wr-task-cb.cancelled { color: var(--wr-text-faint); }
.wr-task-content {
  flex: 1; min-width: 0; font-size: 15px; line-height: 1.5;
  word-break: break-word;
}
.wr-task.is-done .wr-task-content { text-decoration: line-through; color: var(--wr-text-faint); }
.wr-task.is-cancelled .wr-task-content { text-decoration: line-through; color: var(--wr-text-faint); }

/* Task priority badge */
.wr-task-pri {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 4px; height: 16px; border-radius: 3px;
  font-size: 9px; font-weight: 800; flex-shrink: 0; cursor: pointer;
  margin-top: 2px; transition: all 0.15s ease;
}
${priCSS('wr-task-pri')}

/* Task schedule badge */
.wr-task-sched {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 0 5px; height: 16px; border-radius: 3px;
  font-size: 10px; color: var(--wr-text-muted); flex-shrink: 0;
  background: var(--wr-border); cursor: pointer; margin-top: 2px;
}
.wr-task-sched:hover { background: var(--wr-border-strong); }

/* Markdown in task content */
.wr-task-content strong { font-weight: 700; }
.wr-task-content em { font-style: italic; }
.wr-task-content del { text-decoration: line-through; color: var(--wr-text-muted); }
.wr-md-code {
  font-family: "SF Mono", "Fira Code", "Menlo", monospace; font-size: 11px;
  padding: 1px 4px; border-radius: 3px;
  background: var(--wr-border); color: var(--wr-text);
}
.wr-md-link {
  color: var(--wr-blue); text-decoration: none; cursor: pointer;
}
.wr-md-link:hover { text-decoration: underline; }
.wr-md-highlight {
  background: var(--wr-yellow-soft); color: var(--wr-yellow);
  padding: 0 2px; border-radius: 2px;
}
.wr-tag, .wr-mention {
  color: var(--wr-orange); font-weight: 600;
}
.wr-comment {
  color: var(--wr-text-faint); font-style: italic;
}

/* Task hover actions */
.wr-task-acts {
  display: none; align-items: center; gap: 2px; flex-shrink: 0; margin-top: 1px;
}
.wr-task:hover .wr-task-acts { display: flex; }
.wr-task-act {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  border-radius: 3px; border: none; background: transparent;
  color: var(--wr-text-faint); cursor: pointer; font-size: 10px; transition: all 0.1s ease;
}
.wr-task-act:hover { background: var(--wr-border-strong); color: var(--wr-text); }
.wr-task-act.cancel:hover { color: var(--wr-red); }

/* ---- Schedule Picker Dropdown ---- */
.wr-sched-picker {
  position: fixed; z-index: 500;
  background: var(--wr-bg-card); border: 1px solid var(--wr-border-strong);
  border-radius: var(--wr-radius-sm); box-shadow: 0 8px 24px color-mix(in srgb, black 25%, transparent);
  padding: 4px; min-width: 150px;
}
.wr-sched-opt {
  display: block; width: 100%; padding: 5px 10px; font-size: 12px;
  border: none; background: transparent; color: var(--wr-text);
  text-align: left; border-radius: var(--wr-radius-xs); cursor: pointer;
}
.wr-sched-opt:hover { background: var(--wr-border); }
.wr-sched-opt.danger { color: var(--wr-red); }
.wr-sched-date-input {
  width: 100%; padding: 4px 8px; margin: 2px 0;
  font-size: 12px; border: 1px solid var(--wr-border-strong);
  border-radius: var(--wr-radius-xs); background: var(--wr-bg);
  color: var(--wr-text); outline: none;
}

/* ---- Add Task Input ---- */
.wr-task-add {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 4px; margin-top: 4px;
}
.wr-task-add-input {
  flex: 1; padding: 5px 8px; font-size: 12px;
  border: 1px solid var(--wr-border); border-radius: var(--wr-radius-sm);
  background: var(--wr-bg); color: var(--wr-text);
  outline: none; transition: border-color 0.15s ease;
}
.wr-task-add-input:focus { border-color: var(--wr-accent); }
.wr-task-add-input::placeholder { color: var(--wr-text-faint); }
`;
}

/**
 * Build the complete HTML document with all CSS embedded inline
 */
function buildFullHTML(bodyContent) {
  const themeCSS = getThemeCSS();
  const pluginCSS = getInlineCSS();

  // FontAwesome via relative paths to np.Shared (known working pattern)
  const faLinks = `
    <link href="../np.Shared/fontawesome.css" rel="stylesheet">
    <link href="../np.Shared/regular.min.flat4NP.css" rel="stylesheet">
    <link href="../np.Shared/solid.min.flat4NP.css" rel="stylesheet">
  `;

  const themeAttr = isLightTheme() ? 'light' : 'dark';
  return `<!DOCTYPE html>
<html data-theme="${themeAttr}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1, viewport-fit=cover">
  <title>Weekly Review</title>
  ${faLinks}
  <style>${themeCSS}\n${pluginCSS}</style>
</head>
<body>
  ${bodyContent}
  <script>
    var receivingPluginID = '${PLUGIN_ID}';
  </script>
  <script type="text/javascript" src="../np.Shared/pluginToHTMLCommsBridge.js"><\/script>
  <script type="text/javascript" src="weeklyReviewEvents.js"><\/script>
</body>
</html>`;
}

// ============================================
// NOTE MUTATION — @reviewed update
// ============================================

/**
 * Update @reviewed(date) in a note's metadata line.
 * The metadata line is line index 1 (second line), or the first line containing @review.
 */
function updateReviewedDate(note) {
  if (!note) return false;
  const config = getSettings();
  const today = getTodayStr();

  // Check if note uses frontmatter
  const fm = parseFrontmatter(note.content || '').frontmatter;
  if (fm.type === 'project' || fm.type === 'area' || fm.reviewed !== undefined || fm.review !== undefined) {
    // Update via frontmatter
    setFrontmatterKey(note, 'reviewed', today);
    DataStore.updateCache(note, true);
    return true;
  }

  // Fall back to mention-based update
  const newMention = `${config.reviewedMentionStr}(${today})`;
  const reviewedPattern = new RegExp(config.reviewedMentionStr.replace('@', '@') + '\\([^)]*\\)');

  const paras = note.paragraphs;
  if (!paras || paras.length < 2) return false;

  let metaLineIdx = -1;
  for (let i = 1; i < Math.min(paras.length, 10); i++) {
    const content = paras[i].content || '';
    if (content.includes(config.reviewMentionStr + '(') || content.includes(config.reviewedMentionStr + '(')) {
      metaLineIdx = i;
      break;
    }
  }

  if (metaLineIdx === -1) metaLineIdx = 1;

  const para = paras[metaLineIdx];
  let content = para.content || '';

  if (reviewedPattern.test(content)) {
    content = content.replace(reviewedPattern, newMention);
  } else {
    content = content.trimEnd() + ' ' + newMention;
  }

  para.content = content;
  note.updateParagraph(para);
  DataStore.updateCache(note, true);
  return true;
}

// ============================================
// TASK DATA EXTRACTION
// ============================================

/**
 * Extract structured task data from a note, grouped by heading sections
 */
function getNoteTasks(filename) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;

  const paras = note.paragraphs || [];
  const sections = [];
  let currentSection = { heading: '', headingLevel: 0, headingLineIndex: -1, tasks: [] };

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];

    if (p.type === 'title' && p.headingLevel && p.headingLevel >= 2) {
      if (currentSection.tasks.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: p.content || '',
        headingLevel: p.headingLevel,
        headingLineIndex: i,
        tasks: [],
      };
    } else if (p.type === 'open' || p.type === 'done' || p.type === 'cancelled') {
      let content = p.content || '';

      // Parse priority
      let priority = 0;
      if (content.startsWith('!!! ')) priority = 3;
      else if (content.startsWith('!! ')) priority = 2;
      else if (content.startsWith('! ')) priority = 1;

      // Parse scheduled date (>YYYY-MM-DD or >YYYY-Www)
      const schedMatch = content.match(/>(\d{4}-\d{2}-\d{2})/);
      const weekMatch = content.match(/>(\d{4}-W\d{2})/);
      const scheduledDate = schedMatch ? schedMatch[1] : null;
      const scheduledWeek = weekMatch ? weekMatch[1] : null;

      // Clean display content
      let display = content;
      display = display.replace(/^!{1,3}\s*/, '');
      display = display.replace(/\s*>\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2}\s*(AM|PM)(\s*-\s*\d{1,2}:\d{2}\s*(AM|PM))?)?/gi, '');
      display = display.replace(/\s*>\d{4}-W\d{2}/g, '');
      display = display.replace(/\s*>today/g, '');
      display = display.replace(/\s*@done\([^)]*\)/g, '');
      display = display.replace(/\s*@repeat\([^)]*\)/g, '');

      currentSection.tasks.push({
        lineIndex: i,
        content: display.trim(),
        contentHTML: renderMarkdown(display.trim()),
        rawContent: content,
        type: p.type,
        indentLevel: p.indentLevel || 0,
        priority: priority,
        scheduledDate: scheduledDate,
        scheduledWeek: scheduledWeek,
      });
    }
  }

  if (currentSection.tasks.length > 0) {
    sections.push(currentSection);
  }

  return { sections };
}

// ============================================
// TASK MUTATIONS
// ============================================

/**
 * Toggle a task between open and done
 */
function getDoneTag() {
  var now = new Date();
  var y = now.getFullYear();
  var mo = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  var h = now.getHours();
  var mi = String(now.getMinutes()).padStart(2, '0');
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return '@done(' + y + '-' + mo + '-' + d + ' ' + String(h12).padStart(2, '0') + ':' + mi + ' ' + ampm + ')';
}

function toggleTaskComplete(filename, lineIndex) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;
  const para = note.paragraphs[lineIndex];
  if (!para) return null;

  var config = getSettings();
  if (para.type === 'done' || para.type === 'checklistDone') {
    // Uncomplete: set to open and remove @done()
    para.type = para.type === 'checklistDone' ? 'checklist' : 'open';
    para.content = (para.content || '').replace(/\s*@done\([^)]*\)/, '');
  } else {
    // Complete
    var isChecklist = para.type === 'checklist';
    para.type = isChecklist ? 'checklistDone' : 'done';
    if (config.appendCompletionDate) {
      para.content = (para.content || '').trimEnd() + ' ' + getDoneTag();
    }
  }
  note.updateParagraph(para);
  return { lineIndex, newType: para.type };
}

/**
 * Toggle a task between open and cancelled
 */
function toggleTaskCancel(filename, lineIndex) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;
  const para = note.paragraphs[lineIndex];
  if (!para) return null;

  if (para.type === 'cancelled') {
    para.type = 'open';
  } else {
    para.type = 'cancelled';
  }
  note.updateParagraph(para);
  return { lineIndex, newType: para.type };
}

/**
 * Cycle task priority: none → ! → !! → !!! → none
 */
function cycleTaskPriority(filename, lineIndex) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;
  const para = note.paragraphs[lineIndex];
  if (!para) return null;

  let content = para.content || '';
  let currentPri = 0;
  if (content.startsWith('!!! ')) { currentPri = 3; content = content.slice(4); }
  else if (content.startsWith('!! ')) { currentPri = 2; content = content.slice(3); }
  else if (content.startsWith('! ')) { currentPri = 1; content = content.slice(2); }

  const nextPri = (currentPri + 1) % 4;
  const prefix = nextPri === 3 ? '!!! ' : nextPri === 2 ? '!! ' : nextPri === 1 ? '! ' : '';
  para.content = prefix + content;
  note.updateParagraph(para);
  return { lineIndex, newPriority: nextPri, newContent: para.content };
}

/**
 * Schedule a task with a date string
 */
function scheduleTask(filename, lineIndex, dateStr) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;
  const para = note.paragraphs[lineIndex];
  if (!para) return null;

  let content = para.content || '';
  // Remove existing schedule
  content = content.replace(/\s*>\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2}\s*(AM|PM)(\s*-\s*\d{1,2}:\d{2}\s*(AM|PM))?)?/gi, '');
  content = content.replace(/\s*>\d{4}-W\d{2}/g, '');
  content = content.replace(/\s*>today/g, '');

  if (dateStr) {
    content = content.trimEnd() + ' >' + dateStr;
  }

  para.content = content;
  note.updateParagraph(para);
  return { lineIndex, newContent: para.content, scheduledDate: dateStr };
}

/**
 * Move a task up or down
 */
function moveTask(filename, lineIndex, direction) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;
  const paras = note.paragraphs;
  if (!paras || lineIndex < 0 || lineIndex >= paras.length) return null;

  const targetIndex = direction === 'up' ? lineIndex - 1 : lineIndex + 1;
  if (targetIndex < 0 || targetIndex >= paras.length) return null;

  // Swap content and type between the two paragraphs
  const srcPara = paras[lineIndex];
  const dstPara = paras[targetIndex];

  const tmpContent = srcPara.content;
  const tmpType = srcPara.type;
  const tmpIndent = srcPara.indentLevel;

  srcPara.content = dstPara.content;
  srcPara.type = dstPara.type;
  if (typeof srcPara.indentLevel !== 'undefined') srcPara.indentLevel = dstPara.indentLevel;

  dstPara.content = tmpContent;
  dstPara.type = tmpType;
  if (typeof dstPara.indentLevel !== 'undefined') dstPara.indentLevel = tmpIndent;

  note.updateParagraph(srcPara);
  note.updateParagraph(dstPara);
  return { oldIndex: lineIndex, newIndex: targetIndex };
}

/**
 * Add a new task to a note
 */
function addTaskToNote(filename, taskText, afterLineIndex) {
  const note = DataStore.projectNoteByFilename(filename);
  if (!note) return null;

  // Insert after the specified line, or at end
  const insertIndex = (afterLineIndex !== null && afterLineIndex !== undefined)
    ? afterLineIndex + 1
    : note.paragraphs.length;

  note.insertParagraph(taskText, insertIndex, 'open');
  return { lineIndex: insertIndex };
}

// ============================================
// PLUGIN COMMANDS
// ============================================

/**
 * Main command: show the Weekly Review Dashboard
 */
async function showWeeklyReviewDashboard() {
  try {
    CommandBar.showLoading(true, 'Scanning projects...');
    await CommandBar.onAsyncThread();

    const projects = scanProjects();
    const bodyContent = buildDashboardHTML(projects);
    const fullHTML = buildFullHTML(bodyContent);

    await CommandBar.onMainThread();
    CommandBar.showLoading(false);

    const winOptions = {
      customId: WINDOW_ID,
      savedFilename: '../../asktru.WeeklyReview/review_dashboard.html',
      shouldFocus: true,
      reuseUsersWindowRect: true,
      headerBGColor: 'transparent',
      autoTopPadding: true,
      showReloadButton: true,
      reloadPluginID: PLUGIN_ID,
      reloadCommandName: 'Weekly Review Dashboard',
      icon: 'fa-list-check',
      iconColor: '#7C3AED',
    };

    // Use showInMainWindow for sidebar embedding (like Linear Calendar, Favorites)
    const result = await HTMLView.showInMainWindow(fullHTML, 'Weekly Review', winOptions);
    if (!result || !result.success) {
      // Fallback to floating window if main window API not available
      console.log('WeeklyReview: showInMainWindow failed, falling back to floating window');
      await HTMLView.showWindowWithOptions(fullHTML, 'Weekly Review', winOptions);
    }
  } catch (err) {
    CommandBar.showLoading(false);
    console.log('WeeklyReview error: ' + String(err));
  }
}

/**
 * Refresh the dashboard
 */
async function refreshDashboard() {
  await showWeeklyReviewDashboard();
}

/**
 * Mark the currently open note as reviewed
 */
async function markCurrentNoteReviewed() {
  const note = Editor.note;
  if (!note) {
    await CommandBar.prompt('No note is currently open.', '');
    return;
  }
  const success = updateReviewedDate(note);
  if (success) {
    await CommandBar.prompt('Marked as reviewed today!', '');
  } else {
    await CommandBar.prompt('Could not update review date.', '');
  }
}

/**
 * Handle messages from the HTML window
 */
async function onMessageFromHTMLView(actionType, data) {
  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;

    switch (actionType) {
      case 'markReviewed': {
        const filename = decSafe(parsedData.encodedFilename);
        const note = DataStore.projectNoteByFilename(filename);
        if (note) {
          const success = updateReviewedDate(note);
          if (success) {
            // Send update to HTML window to reflect the change
            sendToHTMLWindow(WINDOW_ID, 'UPDATE_CARD', {
              encodedFilename: parsedData.encodedFilename,
              newStatus: 'fresh',
            });
            sendToHTMLWindow(WINDOW_ID, 'SHOW_TOAST', { message: `Reviewed: ${note.title || filename}` });
          }
        }
        break;
      }

      case 'openNote': {
        const filename = decSafe(parsedData.encodedFilename);
        const note = DataStore.projectNoteByFilename(filename);
        if (note) {
          var noteTitle = note.title || '';
          if (noteTitle) {
            NotePlan.openURL('noteplan://x-callback-url/openNote?noteTitle=' + encodeURIComponent(noteTitle) + '&splitView=yes&reuseSplitView=yes');
          } else {
            await Editor.openNoteByFilename(filename);
          }
        }
        break;
      }

      case 'refreshDashboard': {
        await showWeeklyReviewDashboard();
        break;
      }

      case 'startReviewAll': {
        const projects = scanProjects();
        const overdue = projects.filter(p => p.reviewStatus === 'overdue' || p.reviewStatus === 'due');
        if (overdue.length > 0) {
          await Editor.openNoteByFilename(overdue[0].filename);
        }
        break;
      }

      case 'expandCard': {
        const filename = decSafe(parsedData.encodedFilename);
        const taskData = getNoteTasks(filename);
        if (taskData) {
          await sendToHTMLWindow(WINDOW_ID, 'CARD_TASKS', {
            encodedFilename: parsedData.encodedFilename,
            sections: taskData.sections,
          });
        }
        break;
      }

      case 'toggleTaskComplete': {
        const filename = decSafe(parsedData.encodedFilename);
        // Save window ID before cross-plugin call (Routine may overwrite globals)
        const myWindowId = 'asktru.WeeklyReview.dashboard';
        const tcNote = DataStore.projectNoteByFilename(filename);
        const tcPara = tcNote ? tcNote.paragraphs[parsedData.lineIndex] : null;
        const tcHasRepeat = tcPara && (tcPara.content || '').indexOf('@repeat') >= 0;
        const tcWasOpen = tcPara && (tcPara.type === 'open' || tcPara.type === 'checklist');
        const result = toggleTaskComplete(filename, parsedData.lineIndex);
        if (result) {
          await sendToHTMLWindow(myWindowId, 'TASK_UPDATED', {
            encodedFilename: parsedData.encodedFilename,
            lineIndex: result.lineIndex,
            newType: result.newType,
          });
          // If task had @repeat and was just completed, invoke Routine then refresh card
          if (tcHasRepeat && tcWasOpen && (result.newType === 'done' || result.newType === 'checklistDone')) {
            try {
              await DataStore.invokePluginCommandByName('generate repeats', 'asktru.Routine', [filename]);
              // Re-fetch tasks to show the newly created repeat
              const refreshedTasks = getNoteTasks(filename);
              if (refreshedTasks) {
                await sendToHTMLWindow(myWindowId, 'CARD_TASKS', {
                  encodedFilename: parsedData.encodedFilename,
                  sections: refreshedTasks.sections,
                });
              }
            } catch (e) { console.log('WeeklyReview: Routine plugin not available: ' + String(e)); }
          }
        }
        break;
      }

      case 'toggleTaskCancel': {
        const filename = decSafe(parsedData.encodedFilename);
        const myWindowId2 = 'asktru.WeeklyReview.dashboard';
        const cnNote = DataStore.projectNoteByFilename(filename);
        const cnPara = cnNote ? cnNote.paragraphs[parsedData.lineIndex] : null;
        const cnHasRepeat = cnPara && (cnPara.content || '').indexOf('@repeat') >= 0;
        const cnWasOpen = cnPara && (cnPara.type === 'open' || cnPara.type === 'checklist');
        const result = toggleTaskCancel(filename, parsedData.lineIndex);
        if (result) {
          await sendToHTMLWindow(myWindowId2, 'TASK_UPDATED', {
            encodedFilename: parsedData.encodedFilename,
            lineIndex: result.lineIndex,
            newType: result.newType,
          });
          // If task had @repeat and was just cancelled, invoke Routine
          if (cnHasRepeat && cnWasOpen && (result.newType === 'cancelled' || result.newType === 'checklistCancelled')) {
            try {
              await DataStore.invokePluginCommandByName('generate repeats', 'asktru.Routine', [filename]);
              const cnRefreshed = getNoteTasks(filename);
              if (cnRefreshed) {
                await sendToHTMLWindow(myWindowId2, 'CARD_TASKS', {
                  encodedFilename: parsedData.encodedFilename,
                  sections: cnRefreshed.sections,
                });
              }
            } catch (e) { console.log('WeeklyReview: Routine plugin not available: ' + String(e)); }
          }
        }
        break;
      }

      case 'cycleTaskPriority': {
        const filename = decSafe(parsedData.encodedFilename);
        const result = cycleTaskPriority(filename, parsedData.lineIndex);
        if (result) {
          await sendToHTMLWindow(WINDOW_ID, 'TASK_PRIORITY_CHANGED', {
            encodedFilename: parsedData.encodedFilename,
            lineIndex: result.lineIndex,
            newPriority: result.newPriority,
          });
        }
        break;
      }

      case 'scheduleTask': {
        const filename = decSafe(parsedData.encodedFilename);
        const result = scheduleTask(filename, parsedData.lineIndex, parsedData.dateStr);
        if (result) {
          await sendToHTMLWindow(WINDOW_ID, 'TASK_SCHEDULED', {
            encodedFilename: parsedData.encodedFilename,
            lineIndex: result.lineIndex,
            scheduledDate: result.scheduledDate,
          });
        }
        break;
      }

      case 'moveTask': {
        const filename = decSafe(parsedData.encodedFilename);
        const result = moveTask(filename, parsedData.lineIndex, parsedData.direction);
        if (result) {
          // Re-fetch all tasks to rebuild the expanded view (reorder changes indices)
          const taskData = getNoteTasks(filename);
          if (taskData) {
            await sendToHTMLWindow(WINDOW_ID, 'CARD_TASKS', {
              encodedFilename: parsedData.encodedFilename,
              sections: taskData.sections,
            });
          }
        }
        break;
      }

      case 'addTask': {
        const filename = decSafe(parsedData.encodedFilename);
        const result = addTaskToNote(filename, parsedData.taskText, parsedData.afterLineIndex);
        if (result) {
          // Re-fetch tasks to get updated data with correct line indices
          const taskData = getNoteTasks(filename);
          if (taskData) {
            await sendToHTMLWindow(WINDOW_ID, 'CARD_TASKS', {
              encodedFilename: parsedData.encodedFilename,
              sections: taskData.sections,
            });
          }
        }
        break;
      }

      default:
        console.log('WeeklyReview: unhandled action: ' + actionType);
    }
  } catch (err) {
    console.log('WeeklyReview onMessage error: ' + String(err));
  }
}

/**
 * Helper: send a message to the HTML window via HTMLView.runJavaScript
 * Uses window.postMessage pattern matching the pluginToHTMLCommsBridge convention
 */
async function sendToHTMLWindow(windowId, type, data) {
  try {
    if (typeof HTMLView === 'undefined' || typeof HTMLView.runJavaScript !== 'function') {
      console.log('sendToHTMLWindow: HTMLView API not available');
      return;
    }
    const payload = { ...data, NPWindowID: windowId };
    const stringifiedPayload = JSON.stringify(payload);
    const doubleStringified = JSON.stringify(stringifiedPayload);
    const jsCode = `
      (function() {
        try {
          var payloadDataString = ${doubleStringified};
          var payloadData = JSON.parse(payloadDataString);
          var messageObj = { type: '${type}', payload: payloadData };
          window.postMessage(messageObj, '*');
        } catch (error) {
          console.error('sendToHTMLWindow: Error in postMessage:', error);
        }
      })();
    `;
    await HTMLView.runJavaScript(jsCode, windowId);
  } catch (err) {
    console.log('sendToHTMLWindow error: ' + String(err));
  }
}

// ============================================
// EXPORTS — NotePlan requires globalThis assignment
// ============================================

// ============================================
// SLASH COMMANDS: Turn into project/area
// ============================================

function removeBodyTag(note, tag) {
  var paras = note.paragraphs;
  var cleanTag = tag.startsWith('#') ? tag : '#' + tag;
  for (var i = 0; i < paras.length; i++) {
    var content = paras[i].content || '';
    if (content.indexOf(cleanTag) >= 0) {
      paras[i].content = content.replace(new RegExp('\\s*' + cleanTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '').trim();
      note.updateParagraph(paras[i]);
    }
  }
}

function removeBodyMention(note, mentionKey) {
  var paras = note.paragraphs;
  var pattern = new RegExp('\\s*' + mentionKey.replace('@', '@') + '\\([^)]*\\)', 'g');
  for (var i = 0; i < paras.length; i++) {
    var content = paras[i].content || '';
    if (pattern.test(content)) {
      paras[i].content = content.replace(pattern, '').trim();
      note.updateParagraph(paras[i]);
    }
  }
}

async function turnIntoProject() {
  var note = Editor.note;
  if (!note) { await CommandBar.prompt('No note open', 'Open a note first.'); return; }

  setFrontmatterKey(note, 'type', 'project');

  var config = getSettings();
  var mentions = note.mentions || [];
  var reviewVal = getMentionValue(mentions, config.reviewMentionStr);
  var reviewedVal = getMentionValue(mentions, config.reviewedMentionStr);
  if (reviewVal) {
    setFrontmatterKey(note, 'review', reviewVal);
    removeBodyMention(note, config.reviewMentionStr);
  }
  if (reviewedVal) {
    setFrontmatterKey(note, 'reviewed', reviewedVal);
    removeBodyMention(note, config.reviewedMentionStr);
  }

  removeBodyTag(note, '#project');
  removeBodyTag(note, '#area');

  var fm = parseFrontmatter(note.content || '').frontmatter;
  if (!fm.review) setFrontmatterKey(note, 'review', '1w');

  DataStore.updateCache(note, true);
  // Re-open the note to ensure it stays selected after content change
  await Editor.openNoteByFilename(note.filename);
  await CommandBar.prompt('Done', 'Note is now a project with frontmatter-based review tracking.');
}

async function turnIntoArea() {
  var note = Editor.note;
  if (!note) { await CommandBar.prompt('No note open', 'Open a note first.'); return; }

  setFrontmatterKey(note, 'type', 'area');

  var config = getSettings();
  var mentions = note.mentions || [];
  var reviewVal = getMentionValue(mentions, config.reviewMentionStr);
  var reviewedVal = getMentionValue(mentions, config.reviewedMentionStr);
  if (reviewVal) {
    setFrontmatterKey(note, 'review', reviewVal);
    removeBodyMention(note, config.reviewMentionStr);
  }
  if (reviewedVal) {
    setFrontmatterKey(note, 'reviewed', reviewedVal);
    removeBodyMention(note, config.reviewedMentionStr);
  }

  removeBodyTag(note, '#project');
  removeBodyTag(note, '#area');

  var fm = parseFrontmatter(note.content || '').frontmatter;
  if (!fm.review) setFrontmatterKey(note, 'review', '1w');

  DataStore.updateCache(note, true);
  await Editor.openNoteByFilename(note.filename);
  await CommandBar.prompt('Done', 'Note is now an area with frontmatter-based review tracking.');
}

globalThis.showWeeklyReviewDashboard = showWeeklyReviewDashboard;
globalThis.onMessageFromHTMLView = onMessageFromHTMLView;
globalThis.markCurrentNoteReviewed = markCurrentNoteReviewed;
globalThis.refreshDashboard = refreshDashboard;
globalThis.turnIntoProject = turnIntoProject;
globalThis.turnIntoArea = turnIntoArea;
