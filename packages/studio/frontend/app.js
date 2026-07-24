/**
 * jcell Studio — Frontend Application
 *
 * A vanilla-JS single-page application with hash-based routing.
 * All features: Dashboard, Data Browser, Schema Viewer, Query Runner,
 * Relations Explorer, and Migration Runner.
 */

// ======================================================================
// State
// ======================================================================

const state = {
  collections: [],
  currentView: 'dashboard',
  dataBrowser: {
    collection: null,
    docs: [],
    total: 0,
    page: 1,
    limit: 50,
    filter: '',
    sort: null,
    order: 'asc',
    loading: false,
  },
  schemaViewer: {
    collection: null,
    schema: null,
  },
  queryRunner: {
    collection: '',
    query: JSON.stringify({ filter: {} }, null, 2),
    result: null,
    loading: false,
  },
  relations: {
    data: [],
    loading: false,
  },
  migrations: {
    data: [],
    loading: false,
  },
  theme: 'dark',
}

// ======================================================================
// API Client
// ======================================================================

const api = {
  async request(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'content-type': 'application/json' },
      ...options,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error || res.statusText)
    }
    return res.json()
  },

  async getCollections() {
    return this.request('/api/collections')
  },

  async getCollectionData(name, params = {}) {
    const query = new URLSearchParams()
    if (params.filter) query.set('filter', params.filter)
    if (params.sort) query.set('sort', params.sort)
    if (params.order) query.set('order', params.order)
    if (params.page) query.set('page', String(params.page))
    if (params.limit) query.set('limit', String(params.limit))
    return this.request(`/api/collections/${encodeURIComponent(name)}?${query}`)
  },

  async getCollectionSchema(name) {
    return this.request(`/api/collections/${encodeURIComponent(name)}/schema`)
  },

  async insertDocument(collection, doc) {
    return this.request(`/api/collections/${encodeURIComponent(collection)}/documents`, {
      method: 'POST',
      body: JSON.stringify(doc),
    })
  },

  async updateDocument(collection, id, changes) {
    return this.request(`/api/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(changes),
    })
  },

  async deleteDocument(collection, id) {
    return this.request(`/api/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async runQuery(collection, filter) {
    return this.request('/api/query', {
      method: 'POST',
      body: JSON.stringify({ collection, filter }),
    })
  },

  async getRelations() {
    return this.request('/api/relations')
  },

  async getMigrations() {
    return this.request('/api/migrations')
  },

  async getStats() {
    return this.request('/api/stats')
  },
}

// ======================================================================
// Router
// ======================================================================

function navigateTo(view) {
  window.location.hash = view
}

function getViewFromHash() {
  const hash = window.location.hash.slice(1) || 'dashboard'
  // Support hash format like: data-browser-users → view=data-browser, collection=users
  for (const view of ['data-browser', 'schema-viewer', 'query-runner', 'relations', 'migrations', 'dashboard']) {
    if (hash === view) return { view, param: null }
    if (hash.startsWith(view + '-')) {
      return { view, param: decodeURIComponent(hash.slice(view.length + 1)) }
    }
  }
  return { view: 'dashboard', param: null }
}

// ======================================================================
// DOM Helpers
// ======================================================================

function $(sel, parent = document) {
  return parent.querySelector(sel)
}

function $$(sel, parent = document) {
  return [...parent.querySelectorAll(sel)]
}

function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag)
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') el.className = val
    else if (key === 'textContent') el.textContent = val
    else if (key === 'innerHTML') el.innerHTML = val
    else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val)
    else if (key.startsWith('data-')) el.setAttribute(key, val)
    else if (key === 'onclick') el.onclick = val
    else el.setAttribute(key, val)
  }
  for (const child of children) {
    if (typeof child === 'string') el.appendChild(document.createTextNode(child))
    else if (child instanceof Node) el.appendChild(child)
  }
  return el
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(String(str)))
  return div.innerHTML
}

function truncate(str, len = 80) {
  if (!str) return ''
  const s = String(str)
  return s.length > len ? s.slice(0, len) + '…' : s
}

function formatDate(date) {
  if (!date) return ''
  try {
    return new Date(date).toLocaleString()
  } catch {
    return String(date)
  }
}

function toast(message, type = 'success') {
  const container = document.getElementById('toastContainer')
  const el = createElement('div', { className: `toast toast-${type}`, textContent: message })
  container.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(100%)'
    el.style.transition = 'all 0.3s ease'
    setTimeout(() => el.remove(), 300)
  }, 3000)
}

// ======================================================================
// Type badge
// ======================================================================

function typeBadge(type) {
  const badges = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    object: 'object',
    array: 'array',
    'null': 'null',
    id: 'id',
  }
  const cls = badges[type] || 'string'
  return `<span class="badge badge-${cls}">${type}</span>`
}

// ======================================================================
// Views
// ======================================================================

// ── Dashboard ────────────────────────────────────────────────────────

async function renderDashboard() {
  const main = document.getElementById('mainContent')
  main.innerHTML = '<div class="loading-screen"><div class="loading-spinner"></div><p>Loading dashboard...</p></div>'

  try {
    const stats = await api.getStats()
    const collections = stats.collections || []

    main.innerHTML = `
      <div class="view active" id="view-dashboard">
        <div class="view-header">
          <h2>Dashboard</h2>
          <p>Overview of your jcell database</p>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Collections</div>
            <div class="stat-value">${stats.totalCollections}</div>
            <div class="stat-sub">Total tables</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Documents</div>
            <div class="stat-value">${stats.totalDocuments.toLocaleString()}</div>
            <div class="stat-sub">Total rows across all collections</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Adapter</div>
            <div class="stat-value" style="font-size:1.4rem">${stats.adapter}</div>
            <div class="stat-sub">Storage backend</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Data Path</div>
            <div class="stat-value" style="font-size:1.1rem;word-break:break-all">${stats.path}</div>
            <div class="stat-sub">Database location</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Collections</h3>
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('data-browser')">
              Browse Data →
            </button>
          </div>
          ${collections.length === 0
            ? '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">No collections found</div><div class="empty-sub">Add some data to get started</div></div>'
            : `<div class="table-container">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Collection</th>
                      <th style="text-align:right">Documents</th>
                      <th style="text-align:right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${collections.map(c => `
                      <tr>
                        <td><strong>${escapeHtml(c.name)}</strong></td>
                        <td style="text-align:right">${c.documentCount.toLocaleString()}</td>
                        <td style="text-align:right">
                          <button class="btn btn-sm btn-secondary" onclick="navigateTo('data-browser-' + encodeURIComponent('${escapeHtml(c.name)}'))">Browse</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`
          }
        </div>
      </div>
    `
  } catch (err) {
    main.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <div class="empty-text">Failed to load dashboard</div>
        <div class="empty-sub">${escapeHtml(err.message)}</div>
        <button class="btn btn-primary" onclick="renderDashboard()" style="margin-top:16px">Retry</button>
      </div>
    `
  }
}

// ── Data Browser ─────────────────────────────────────────────────────

async function renderDataBrowser(param) {
  const main = document.getElementById('mainContent')
  const { dataBrowser: db } = state

  // If a collection was passed via hash param, pre-select it
  if (param) {
    state.dataBrowser.collection = param
  }

  // Fetch collections if needed
  if (state.collections.length === 0) {
    try {
      state.collections = await api.getCollections()
    } catch {}
  }

  main.innerHTML = `
    <div class="view active" id="view-data-browser">
      <div class="view-header">
        <h2>Data Browser</h2>
        <p>Browse, filter, sort, and edit your collection data</p>
      </div>

      <div class="toolbar">
        <div class="collection-selector">
          <select id="collectionSelect" onchange="onCollectionChange(this.value)">
            <option value="">— Select collection —</option>
            ${state.collections.map(c =>
              `<option value="${escapeHtml(c.name)}" ${c.name === db.collection ? 'selected' : ''}>${escapeHtml(c.name)} (${c.documentCount})</option>`
            ).join('')}
          </select>
        </div>
        <input type="text" class="search-input" id="filterInput" placeholder="Search across all fields..." value="${escapeHtml(db.filter)}" oninput="onFilterChange(this.value)" />
        <button class="btn btn-primary btn-sm" id="addDocBtn" onclick="showAddDocumentModal()" ${!db.collection ? 'disabled' : ''}>+ Add</button>
        <button class="btn btn-secondary btn-sm" onclick="refreshDataBrowser()" title="Refresh">↻ Refresh</button>
      </div>

      <div id="dataBrowserContent">
        ${!db.collection
          ? '<div class="empty-state"><div class="empty-icon">🗂️</div><div class="empty-text">Select a collection to browse</div><div class="empty-sub">Choose from the dropdown above</div></div>'
          : '<div class="loading-screen"><div class="loading-spinner"></div><p>Loading data...</p></div>'
        }
      </div>
    </div>
  `

  if (db.collection) {
    await loadDataBrowserData()
  }
}

async function loadDataBrowserData() {
  const { dataBrowser: db } = state
  const content = document.getElementById('dataBrowserContent')
  if (!content) return

  db.loading = true
  db.page = db.page || 1
  db.limit = db.limit || 50

  try {
    const result = await api.getCollectionData(db.collection, {
      filter: db.filter || undefined,
      sort: db.sort || undefined,
      order: db.order || 'asc',
      page: db.page,
      limit: db.limit,
    })

    db.docs = result.docs || []
    db.total = result.total || 0

    const totalPages = Math.max(1, Math.ceil(db.total / db.limit))
    const fields = db.docs.length > 0 ? Object.keys(db.docs[0]) : ['id']

    content.innerHTML = `
      <div class="table-container">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              ${fields.map(f => `
                <th class="sortable ${db.sort === f ? (db.order === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                    onclick="onSortClick('${escapeHtml(f)}')"
                    title="Sort by ${escapeHtml(f)}">
                  ${escapeHtml(f)}
                </th>
              `).join('')}
              <th style="width:60px;text-align:center">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${db.docs.length === 0
              ? `<tr><td colspan="${fields.length + 1}" style="text-align:center;padding:40px;color:var(--text-tertiary)">No documents found</td></tr>`
              : db.docs.map(doc => {
                  const id = doc.id || ''
                  return `<tr>
                    ${fields.map(f => {
                      const val = doc[f]
                      const display = formatCellValue(val, f)
                      const cellClass = getCellClass(f, val)
                      return `<td class="${cellClass}">
                        <span class="cell-editable" onclick="startInlineEdit('${escapeHtml(f)}', '${escapeHtml(String(id))}', this)" title="Click to edit">${display}</span>
                      </td>`
                    }).join('')}
                    <td style="text-align:center">
                      <button class="btn btn-sm btn-danger btn-icon" onclick="confirmDelete('${escapeHtml(id)}')" title="Delete">✕</button>
                    </td>
                  </tr>`
                }).join('')
            }
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="pagination">
          <span>${db.total.toLocaleString()} documents</span>
          <span style="flex:1"></span>
          <div class="per-page">
            <span>Per page:</span>
            <select onchange="onLimitChange(Number(this.value))">
              ${[10, 25, 50, 100, 250].map(n =>
                `<option value="${n}" ${n === db.limit ? 'selected' : ''}>${n}</option>`
              ).join('')}
            </select>
          </div>
          <button onclick="goToPage(${db.page - 1})" ${db.page <= 1 ? 'disabled' : ''}>‹ Prev</button>
          <span class="page-info">Page ${db.page} of ${totalPages}</span>
          <button onclick="goToPage(${db.page + 1})" ${db.page >= totalPages ? 'disabled' : ''}>Next ›</button>
        </div>
      </div>
    `
  } catch (err) {
    content.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <div class="empty-text">Failed to load data</div>
        <div class="empty-sub">${escapeHtml(err.message)}</div>
      </div>
    `
  } finally {
    db.loading = false
  }
}

function formatCellValue(val, field) {
  if (val === null || val === undefined) return '<span style="color:var(--text-tertiary)">null</span>'
  if (typeof val === 'boolean') return val ? '✅' : '❌'
  if (field === 'id') return `<span class="cell-id">${escapeHtml(String(val))}</span>`
  if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val))) {
    return formatDate(val)
  }
  if (typeof val === 'object') {
    return `<span class="json-value">${escapeHtml(JSON.stringify(val, null, 1))}</span>`
  }
  return escapeHtml(truncate(String(val), 120))
}

function getCellClass(field, val) {
  if (typeof val === 'number') return 'cell-number'
  if (typeof val === 'boolean') return 'cell-boolean'
  if (field === 'id') return ''
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) return 'cell-date'
  return ''
}

async function refreshDataBrowser() {
  if (state.dataBrowser.collection) {
    await loadDataBrowserData()
    toast('Data refreshed')
  }
}

function onCollectionChange(value) {
  state.dataBrowser.collection = value || null
  state.dataBrowser.page = 1
  state.dataBrowser.filter = ''
  state.dataBrowser.sort = null
  state.dataBrowser.order = 'asc'
  if (value) {
    loadDataBrowserData()
  } else {
    renderDataBrowser()
  }
}

function onFilterChange(value) {
  state.dataBrowser.filter = value
  state.dataBrowser.page = 1
  clearTimeout(window._filterTimer)
  window._filterTimer = setTimeout(() => loadDataBrowserData(), 300)
}

function onSortClick(field) {
  const db = state.dataBrowser
  if (db.sort === field) {
    db.order = db.order === 'asc' ? 'desc' : 'asc'
  } else {
    db.sort = field
    db.order = 'asc'
  }
  loadDataBrowserData()
}

function goToPage(page) {
  const db = state.dataBrowser
  const totalPages = Math.max(1, Math.ceil(db.total / db.limit))
  if (page < 1 || page > totalPages) return
  db.page = page
  loadDataBrowserData()
}

function onLimitChange(limit) {
  state.dataBrowser.limit = limit
  state.dataBrowser.page = 1
  loadDataBrowserData()
}

// ── Inline Editing ───────────────────────────────────────────────────

function startInlineEdit(field, docId, el) {
  const currentText = el.textContent
  const input = createElement('input', {
    type: 'text',
    className: 'inline-edit',
    value: currentText === 'null' ? '' : currentText,
  })
  el.innerHTML = ''
  el.appendChild(input)
  input.focus()
  input.select()

  const finishEdit = async () => {
    const newVal = input.value
    try {
      await api.updateDocument(state.dataBrowser.collection, docId, { [field]: newVal })
      toast('Document updated')
      await loadDataBrowserData()
    } catch (err) {
      toast(`Failed to update: ${err.message}`, 'error')
      el.textContent = currentText
    }
  }

  input.addEventListener('blur', finishEdit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur() }
    if (e.key === 'Escape') { el.textContent = currentText }
  })
}

// ── Add Document Modal ─────────────────────────────────────────────

function showAddDocumentModal() {
  const col = state.dataBrowser.collection
  if (!col) return

  const modal = createElement('div', { className: 'modal-overlay', id: 'addDocModal' })
  modal.onclick = (e) => { if (e.target === modal) modal.remove() }

  const fields = state.dataBrowser.docs.length > 0
    ? Object.keys(state.dataBrowser.docs[0])
    : ['id', 'name']

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Add Document — <code>${escapeHtml(col)}</code></h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <form id="addDocForm" onsubmit="submitAddDocument(event)">
        ${fields.map(f => `
          <div class="form-group">
            <label>${escapeHtml(f)}</label>
            <input type="text" class="form-input" name="${escapeHtml(f)}" placeholder="${f === 'id' ? 'Auto-generated if empty' : ''}" ${f === 'id' ? '' : 'required'} />
          </div>
        `).join('')}
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Document</button>
        </div>
      </form>
    </div>
  `

  document.body.appendChild(modal)
}

async function submitAddDocument(event) {
  event.preventDefault()
  const form = event.target
  const data = new FormData(form)
  const doc = {}
  for (const [key, val] of data.entries()) {
    if (val) doc[key] = val
  }

  try {
    await api.insertDocument(state.dataBrowser.collection, doc)
    toast('Document added')
    document.querySelector('.modal-overlay')?.remove()
    await loadDataBrowserData()
  } catch (err) {
    toast(`Failed to add: ${err.message}`, 'error')
  }
}

// ── Delete Confirmation ─────────────────────────────────────────────

function confirmDelete(id) {
  const modal = createElement('div', { className: 'modal-overlay', id: 'deleteModal' })
  modal.onclick = (e) => { if (e.target === modal) modal.remove() }

  modal.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h3>Delete Document</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <p style="margin-bottom:16px;color:var(--text-secondary)">
        Are you sure you want to delete this document?
      </p>
      <code style="display:block;padding:8px 12px;background:var(--bg-code);border-radius:var(--radius-md);margin-bottom:16px;word-break:break-all">${escapeHtml(id)}</code>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-danger" onclick="executeDelete('${escapeHtml(id)}')">Delete</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)
}

async function executeDelete(id) {
  try {
    await api.deleteDocument(state.dataBrowser.collection, id)
    toast('Document deleted')
    document.querySelector('.modal-overlay')?.remove()
    await loadDataBrowserData()
  } catch (err) {
    toast(`Failed to delete: ${err.message}`, 'error')
  }
}

// ── Schema Viewer ───────────────────────────────────────────────────

async function renderSchemaViewer() {
  const main = document.getElementById('mainContent')

  // Fetch collections
  if (state.collections.length === 0) {
    try {
      state.collections = await api.getCollections()
    } catch {}
  }

  main.innerHTML = `
    <div class="view active" id="view-schema-viewer">
      <div class="view-header">
        <h2>Schema Viewer</h2>
        <p>Inspect field types, flags, and sample values for each collection</p>
      </div>

      <div class="toolbar">
        <div class="collection-selector">
          <select id="schemaCollectionSelect" onchange="loadSchema(this.value)">
            <option value="">— Select collection —</option>
            ${state.collections.map(c =>
              `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.documentCount} docs)</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div id="schemaContent">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-text">Select a collection to view its schema</div>
        </div>
      </div>
    </div>
  `
}

async function loadSchema(collectionName) {
  const content = document.getElementById('schemaContent')
  if (!collectionName) {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">Select a collection to view its schema</div></div>'
    return
  }

  content.innerHTML = '<div class="loading-screen"><div class="loading-spinner"></div><p>Loading schema...</p></div>'

  try {
    const schema = await api.getCollectionSchema(collectionName)

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3><code>${escapeHtml(schema.name)}</code></h3>
          <span style="font-size:0.85rem;color:var(--text-secondary)">${schema.documentCount} documents</span>
        </div>
        ${Object.keys(schema.fields).length === 0
          ? '<div style="padding:16px;color:var(--text-tertiary);text-align:center">No fields found</div>'
          : `<div style="border:1px solid var(--border-primary);border-radius:var(--radius-md);overflow:hidden">
              ${Object.entries(schema.fields).map(([fieldName, info]) => {
                const isId = fieldName === 'id'
                return `<div class="schema-field">
                  <div class="field-name">${escapeHtml(fieldName)}</div>
                  <div class="field-type">${typeBadge(info.type)}</div>
                  <div class="field-flags">
                    ${isId ? '<span class="flag flag-pk">PK</span>' : ''}
                    ${info.required ? '<span class="flag flag-required">Required</span>' : '<span class="flag flag-optional">Optional</span>'}
                  </div>
                  <div class="field-sample">${info.sample !== undefined ? truncate(JSON.stringify(info.sample), 60) : '—'}</div>
                </div>`
              }).join('')}
            </div>`
        }
      </div>
    `
  } catch (err) {
    content.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <div class="empty-text">Failed to load schema</div>
        <div class="empty-sub">${escapeHtml(err.message)}</div>
      </div>
    `
  }
}

// ── Query Runner ────────────────────────────────────────────────────

async function renderQueryRunner() {
  const main = document.getElementById('mainContent')

  if (state.collections.length === 0) {
    try {
      state.collections = await api.getCollections()
    } catch {}
  }

  const qr = state.queryRunner

  main.innerHTML = `
    <div class="view active" id="view-query-runner">
      <div class="view-header">
        <h2>Query Runner</h2>
        <p>Execute custom queries against your collections</p>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Query</h3>
        </div>

        <div class="form-group">
          <label>Collection</label>
          <select id="queryCollectionSelect" class="form-input" onchange="state.queryRunner.collection = this.value">
            <option value="">— Select —</option>
            ${state.collections.map(c =>
              `<option value="${escapeHtml(c.name)}" ${c.name === qr.collection ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
            ).join('')}
          </select>
        </div>

        <div class="form-group">
          <label>Filter (JSON)</label>
          <textarea class="form-input form-textarea query-editor" id="queryEditor"
            placeholder='{&#10;  "role": "admin"&#10;}'
            oninput="state.queryRunner.query = this.value">${qr.query}</textarea>
        </div>

        <div class="form-actions" style="justify-content:flex-start">
          <button class="btn btn-primary" onclick="executeQuery()" id="runQueryBtn">▶ Run Query</button>
          <button class="btn btn-secondary" onclick="clearQuery()">Clear</button>
        </div>
      </div>

      <div id="queryResultContainer">
        ${qr.result !== null ? renderQueryResult(qr.result) : ''}
      </div>
    </div>
  `
}

async function executeQuery() {
  const btn = document.getElementById('runQueryBtn')
  const container = document.getElementById('queryResultContainer')
  const collection = state.queryRunner.collection
  const queryText = state.queryRunner.query

  if (!collection) {
    toast('Please select a collection', 'error')
    return
  }

  let filter
  try {
    filter = JSON.parse(queryText)
  } catch {
    toast('Invalid JSON in query', 'error')
    return
  }

  btn.disabled = true
  btn.textContent = '⏳ Running...'

  try {
    const result = await api.runQuery(collection, filter)
    state.queryRunner.result = result
    container.innerHTML = renderQueryResult(result)
    toast(`Query returned ${result.count} document(s)`)
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="border-color:var(--color-error)">
        <div class="card-header"><h3 style="color:var(--color-error)">Error</h3></div>
        <p style="color:var(--text-secondary)">${escapeHtml(err.message)}</p>
      </div>
    `
    toast(`Query failed: ${err.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '▶ Run Query'
  }
}

function renderQueryResult(result) {
  const docs = result.documents || []
  if (docs.length === 0) {
    return '<div class="card"><div class="result-count">0 documents returned</div></div>'
  }

  const fields = Object.keys(docs[0])

  return `
    <div class="card">
      <div class="card-header">
        <h3>Results</h3>
        <span style="font-size:0.85rem;color:var(--text-secondary)">${docs.length} document(s)</span>
      </div>
      <div class="query-result">
        <div class="result-count">Collection: <strong>${escapeHtml(result.collection)}</strong> · ${docs.length} rows</div>
        ${escapeHtml(JSON.stringify(docs, null, 2))}
      </div>
    </div>
  `
}

function clearQuery() {
  state.queryRunner.query = JSON.stringify({ filter: {} }, null, 2)
  state.queryRunner.result = null
  renderQueryRunner()
}

// ── Relations Explorer ──────────────────────────────────────────────

async function renderRelations() {
  const main = document.getElementById('mainContent')

  main.innerHTML = `
    <div class="view active" id="view-relations">
      <div class="view-header">
        <h2>Relations Explorer</h2>
        <p>See how collections relate to each other via reference fields</p>
      </div>

      <div style="margin-bottom:16px">
        <button class="btn btn-primary" onclick="loadRelations()">🔍 Discover Relations</button>
      </div>

      <div id="relationsContent">
        <div class="empty-state">
          <div class="empty-icon">🔗</div>
          <div class="empty-text">Click "Discover Relations" to analyze your data</div>
          <div class="empty-sub">We'll scan collections for reference fields (e.g. <code>userId</code>, <code>parent_id</code>)</div>
        </div>
      </div>
    </div>
  `
}

async function loadRelations() {
  const content = document.getElementById('relationsContent')
  if (!content) return

  content.innerHTML = '<div class="loading-screen"><div class="loading-spinner"></div><p>Analyzing relations...</p></div>'

  try {
    const relations = await api.getRelations()
    state.relations.data = relations

    if (relations.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔗</div>
          <div class="empty-text">No relations found</div>
          <div class="empty-sub">Define reference fields (e.g. <code>userId</code>, <code>postId</code>) to create relations</div>
        </div>
      `
      return
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Relations (${relations.length})</h3>
        </div>
        ${relations.map(r => `
          <div class="relation-card">
            <span class="rel-from">${escapeHtml(r.from)}</span>
            <span class="rel-arrow">→</span>
            <span class="rel-field">${escapeHtml(r.field)}</span>
            <span class="rel-arrow">→</span>
            <span class="rel-to">${escapeHtml(r.to)}</span>
          </div>
        `).join('')}
      </div>
    `
  } catch (err) {
    content.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <div class="empty-text">Failed to discover relations</div>
        <div class="empty-sub">${escapeHtml(err.message)}</div>
      </div>
    `
  }
}

// ── Migrations ──────────────────────────────────────────────────────

async function renderMigrations() {
  const main = document.getElementById('mainContent')

  main.innerHTML = `
    <div class="view active" id="view-migrations">
      <div class="view-header">
        <h2>Migration Runner</h2>
        <p>View and manage database migrations</p>
      </div>

      <div id="migrationsContent">
        <div class="loading-screen"><div class="loading-spinner"></div><p>Loading migrations...</p></div>
      </div>
    </div>
  `

  await loadMigrations()
}

async function loadMigrations() {
  const content = document.getElementById('migrationsContent')
  if (!content) return

  try {
    const migrations = await api.getMigrations()
    state.migrations.data = migrations

    if (migrations.length === 0) {
      content.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Applied Migrations</h3>
          </div>
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <div class="empty-text">No migrations applied yet</div>
            <div class="empty-sub">Migrations are tracked in the <code>_migrations</code> collection</div>
          </div>
        </div>
      `
      return
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Applied Migrations (${migrations.length})</h3>
        </div>
        ${migrations.map(m => `
          <div class="migration-item">
            <div>
              <div class="migration-name">${escapeHtml(m.name || 'Unnamed')}</div>
              <div class="migration-date">${m.appliedAt ? formatDate(m.appliedAt) : ''} · ID: ${escapeHtml(m.id || '—')}</div>
            </div>
            <span class="migration-status applied">✅ Applied</span>
          </div>
        `).join('')}
      </div>
    `
  } catch (err) {
    content.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <div class="empty-text">Failed to load migrations</div>
        <div class="empty-sub">${escapeHtml(err.message)}</div>
      </div>
    `
  }
}

// ======================================================================
// Theme
// ======================================================================

function initTheme() {
  const saved = localStorage.getItem('jcell-studio-theme') || 'dark'
  state.theme = saved
  document.documentElement.setAttribute('data-theme', saved)
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', state.theme)
  localStorage.setItem('jcell-studio-theme', state.theme)
}

// ======================================================================
// Navigation & Routing
// ======================================================================

const viewRenderers = {
  'dashboard': (param) => renderDashboard(param),
  'data-browser': (param) => renderDataBrowser(param),
  'schema-viewer': (param) => renderSchemaViewer(param),
  'query-runner': (param) => renderQueryRunner(param),
  'relations': (param) => renderRelations(param),
  'migrations': (param) => renderMigrations(param),
}

function switchView(view, param) {
  // Update nav active state
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view))

  // Render the view
  const render = viewRenderers[view]
  if (render) {
    render(param)
  }
}

function handleHashChange() {
  const { view, param } = getViewFromHash()
  state.currentView = view
  switchView(view, param)
}

// ======================================================================
// Init
// ======================================================================

function init() {
  // Theme
  initTheme()

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', toggleTheme)

  // Navigation
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.view)
    })
  })

  // Hash change
  window.addEventListener('hashchange', handleHashChange)

  // Initial render
  handleHashChange()

  // Remove loading screen
  const loading = document.getElementById('loadingScreen')
  if (loading) loading.remove()
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
