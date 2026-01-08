(function () {
  const ROOT = document.getElementById('root');
  if (!ROOT) return;

  const CLIENTS_KEY = 'vogue_clientes';
  const TRANSACTIONS_KEY = 'vogue_transacciones';
  const ENHANCED_ATTR = 'data-client-enhanced';
  const OPEN_CLASS = 'is-expanded';
  const CLIENT_PICKER_ATTR = 'data-client-picker';
  const ORDER_SECTION_ATTR = 'data-client-orders';
  const CARD_CLIENT_CACHE = new WeakMap();
  const CARD_ORDER_CACHE = new WeakMap();
  const STATE = {
    scheduled: false,
    modal: null,
    quotePage: null,
    securityPage: null,
    activePage: null,
    historyModal: null,
    orderModal: null,
    toastHost: null,
  };

  function loadClients() {
    try {
      const raw = localStorage.getItem(CLIENTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function loadTransactions() {
    try {
      const raw = localStorage.getItem(TRANSACTIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      if (/^(javascript|data):/i.test(value)) return '';
      return value;
    }
    if (value.startsWith('//')) return 'https:' + value;
    return 'https://' + value;
  }

  function getOrderLink(order) {
    if (!order) return '';
    return order.enlaceActualizado || order.enlace || '';
  }

  function getClosestTarget(target, selector) {
    if (!target) return null;
    const element = target.nodeType === 1 ? target : target.parentElement;
    if (!element || !element.closest) return null;
    return element.closest(selector);
  }

  function findClientGrids() {
    const grids = Array.from(ROOT.querySelectorAll('div.grid'));
    return grids.filter((grid) => {
      return (
        grid.classList.contains('grid-cols-1') &&
        grid.classList.contains('md:grid-cols-2') &&
        grid.classList.contains('lg:grid-cols-3') &&
        grid.classList.contains('gap-6')
      );
    });
  }

  function scheduleEnhance() {
    if (STATE.scheduled) return;
    STATE.scheduled = true;
    requestAnimationFrame(() => {
      STATE.scheduled = false;
      enhanceAll();
    });
  }

  function enhanceAll() {
    enhanceNav();
    enhanceSecurityTool();
    enhanceDiscountField();
    enhanceClientPicker();
    enhanceHistoryEdit();
    enhanceLoginRecovery();
    bindOrderEditDelegation();
    const grids = findClientGrids();
    if (grids.length === 0) return;
    const clients = loadClients();

    grids.forEach((grid) => {
      const cards = Array.from(grid.children).filter((el) => el.nodeType === 1);
      cards.forEach((card, index) => {
        enhanceCard(card, clients, index);
      });
    });
  }

  function enhanceCard(card, clients, index) {
    if (!(card instanceof HTMLElement)) return;
    const header = card.querySelector('.flex.justify-between.items-start');
    const nameEl = card.querySelector('h3');
    if (!header || !nameEl) return;
    if (!nameEl.textContent || !nameEl.textContent.trim()) return;
    const clientName = nameEl.textContent.trim();

    const client = resolveClient(clients, index, clientName);
    if (client && client.id !== undefined) {
      card.dataset.clientId = String(client.id);
    }
    card.dataset.clientIndex = String(index);
    card.dataset.clientName = clientName;
    if (client) {
      CARD_CLIENT_CACHE.set(card, client);
    }
    card.classList.add('client-card');

    if (card.getAttribute(ENHANCED_ATTR) === 'true') {
      if (client) renderClientOrders(card, client);
      updateDetailsHeight(card);
      return;
    }
    card.setAttribute(ENHANCED_ATTR, 'true');

    header.classList.add('client-card-header');
    setupHeaderActions(header, card);
    wrapDetails(card, header);
    if (client) renderClientOrders(card, client);
    collapseCard(card, true);
    bindCardToggle(header, card);
  }

  function resolveClient(clients, index, name) {
    if (clients && clients[index]) return clients[index];
    if (!clients) return null;
    return clients.find((c) => c && c.nombre === name) || null;
  }

  function setupHeaderActions(header, card) {
    if (header.querySelector('.client-card-actions')) return;

    const deleteBtn = header.querySelector('button');
    const actions = document.createElement('div');
    actions.className = 'client-card-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'client-edit-btn';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openEditModal(card);
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'client-toggle-btn';
    toggleBtn.innerHTML = '<span>Detalles<span class="chevron"></span></span>';
    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCard(card);
    });

    actions.appendChild(editBtn);
    actions.appendChild(toggleBtn);
    if (deleteBtn) {
      deleteBtn.classList.add('client-delete-btn');
      actions.appendChild(deleteBtn);
    }

    header.appendChild(actions);
  }

  function wrapDetails(card, header) {
    const content = card.querySelector('.p-5') || card;
    if (content.querySelector('.client-details')) return;
    const details = document.createElement('div');
    details.className = 'client-details';
    const inner = document.createElement('div');
    inner.className = 'client-details-inner';

    const children = Array.from(content.children);
    children.forEach((child) => {
      if (child === header) return;
      inner.appendChild(child);
    });

    details.appendChild(inner);
    content.appendChild(details);
  }

  function renderClientOrders(card, client) {
    const details = card.querySelector('.client-details-inner');
    if (!details) return;
    let container = details.querySelector('[' + ORDER_SECTION_ATTR + '="true"]');
    if (!container) {
      container = document.createElement('div');
      container.setAttribute(ORDER_SECTION_ATTR, 'true');
      container.className = 'client-orders';
      details.appendChild(container);
    }

    const collected = collectOrdersForClient(client);
    const normalized = collected.orders;
    if (normalized.length === 0) {
      container.innerHTML = '<div class="client-orders-empty">Sin pedidos registrados.</div>';
      return;
    }

    const sorted = normalized.slice().sort((a, b) => getOrderSortValue(b) - getOrderSortValue(a));
    CARD_ORDER_CACHE.set(card, sorted);
    const rows = sorted.map((order, index) => {
      const meta = [];
      const orderLink = getOrderLink(order);
      if (orderLink) {
        meta.push('<a href="' + orderLink + '" target="_blank" rel="noopener" class="client-order-link">Ver pedido</a>');
      }
      if (order.descuentoPct) {
        meta.push('Descuento ' + order.descuentoPct + '%');
      }
      const metaLine = meta.length ? '<div class="client-order-meta">' + meta.join(' • ') + '</div>' : '';
      const notes = formatOrderNotes(order.descripcion);
      const notesLine = notes ? '<div class="client-order-notes">' + notes + '</div>' : '';
      const amount = Number.isFinite(order.monto) && order.monto > 0 ? formatUsd(order.monto) : '';
      const chips = [
        renderOrderChip('Pago', order.pagoCompletado),
        renderOrderChip('Pedido', order.pedidoCompletado),
        renderOrderChip('Entrega', order.entregado)
      ].join('');
      const clientId = card.dataset.clientId || '';
      const clientIndex = card.dataset.clientIndex || '';
      const clientName = card.dataset.clientName || '';
      return [
        '<div class="client-order-item">',
        '  <div class="client-order-main">',
        '    <div class="client-order-name">' + formatOrderLabel(order, index) + '</div>',
        metaLine,
        notesLine,
        '    <div class="client-order-chips">' + chips + '</div>',
        '  </div>',
        '  <div class="client-order-side">',
        '    <div class="client-order-amount">' + amount + '</div>',
        '    <button type="button" class="client-order-edit" data-order-id="' + order.id + '" data-client-id="' + clientId + '" data-client-index="' + clientIndex + '" data-client-name="' + clientName + '">Editar</button>',
        '  </div>',
        '</div>'
      ].join('');
    });

    container.innerHTML = [
      '<div class="client-orders-title">Historial de pedidos</div>',
      '<div class="client-orders-list">',
      rows.join(''),
      '</div>'
    ].join('');

    bindOrderEditButtons(container);
  }

  function renderOrderChip(label, isActive) {
    const cls = isActive ? 'client-order-chip is-active' : 'client-order-chip';
    return '<span class="' + cls + '">' + label + '</span>';
  }

  function handleOrderEditButton(btn) {
    if (!btn) return false;
    const orderId = btn.dataset.orderId || '';
    const data = {
      clientId: btn.dataset.clientId || '',
      clientIndex: btn.dataset.clientIndex || '',
      clientName: btn.dataset.clientName || ''
    };
    let card = btn.closest('.client-card');
    if (!card && data.clientId) {
      card = ROOT.querySelector('.client-card[data-client-id="' + data.clientId + '"]');
    }
    if (!card && data.clientIndex) {
      card = ROOT.querySelector('.client-card[data-client-index="' + data.clientIndex + '"]');
    }
    if (card && openOrderModal(card, orderId)) {
      console.log('✓ Modal abierto desde tarjeta', { orderId, clientId: data.clientId });
      return true;
    }
    if (openOrderModalFromData(data, orderId)) {
      console.log('✓ Modal abierto desde datos', { orderId, clientId: data.clientId });
      return true;
    }
    if (openOrderModalByOrderId(orderId)) {
      console.log('✓ Modal abierto por orderId', { orderId });
      return true;
    }
    console.error('✗ No se pudo abrir el pedido', { orderId, data, hasCard: !!card });
    showToast('No se pudo abrir el pedido.', 'error');
    return false;
  }

  function bindOrderEditButtons(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('.client-order-edit');
    buttons.forEach((btn) => {
      if (btn.dataset.orderBound === 'true') return;
      btn.dataset.orderBound = 'true';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleOrderEditButton(btn);
      });
    });
  }

  function bindOrderEditDelegation() {
    if (ROOT.dataset.orderEditBound === 'true') return;
    ROOT.dataset.orderEditBound = 'true';
    ROOT.addEventListener(
      'click',
      (event) => {
        const link = getClosestTarget(event.target, '.client-order-link');
        if (link) {
          event.preventDefault();
          event.stopPropagation();
          const url = normalizeUrl(link.getAttribute('href'));
          if (url) {
            window.open(url, '_blank', 'noopener');
          }
          return;
        }
        const btn = getClosestTarget(event.target, '.client-order-edit');
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        if (btn.dataset.orderBound === 'true') return;
        handleOrderEditButton(btn);
      },
      true
    );
  }

  function bindCardToggle(header, card) {
    if (header.dataset.clientToggleBound === 'true') return;
    header.dataset.clientToggleBound = 'true';
    header.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      if (event.target.closest('a')) return;
      toggleCard(card);
    });
  }

  function updateDetailsHeight(card) {
    const details = card.querySelector('.client-details');
    if (!details) return;
    if (!card.classList.contains(OPEN_CLASS)) return;
    details.style.maxHeight = details.scrollHeight + 'px';
  }

  function expandCard(card) {
    const details = card.querySelector('.client-details');
    if (!details) return;
    card.classList.add(OPEN_CLASS);
    details.style.maxHeight = details.scrollHeight + 'px';
  }

  function collapseCard(card, silent) {
    const details = card.querySelector('.client-details');
    if (!details) return;
    card.classList.remove(OPEN_CLASS);
    details.style.maxHeight = '0px';
    if (!silent) {
      details.style.opacity = '0';
      details.style.transform = 'translateY(-6px)';
    }
  }

  function toggleCard(card) {
    if (card.classList.contains(OPEN_CLASS)) {
      collapseCard(card, false);
    } else {
      expandCard(card);
    }
  }

  function enhanceNav() {
    const nav = ROOT.querySelector('nav');
    if (!nav) return;
    if (nav.querySelector('[data-nav-page="quote"]')) return;

    const buttons = Array.from(nav.querySelectorAll('button'));
    const clientesBtn = buttons.find((btn) => {
      return btn.textContent && btn.textContent.toLowerCase().includes('clientes');
    });
    const finanzasBtn = buttons.find((btn) => {
      return btn.textContent && btn.textContent.toLowerCase().includes('finanzas');
    });
    if (!clientesBtn || !clientesBtn.parentElement) return;

    const quoteBtn = createNavButton('Cotizacion', 'quote', clientesBtn.className);
    clientesBtn.parentElement.insertBefore(quoteBtn, clientesBtn.nextSibling);

    if (finanzasBtn && finanzasBtn.dataset.navBound !== 'true') {
      finanzasBtn.dataset.navBound = 'true';
      finanzasBtn.addEventListener('click', () => {
        setActivePage(null);
      });
    }
    if (clientesBtn && clientesBtn.dataset.navBound !== 'true') {
      clientesBtn.dataset.navBound = 'true';
      clientesBtn.addEventListener('click', () => {
        setActivePage(null);
      });
    }

    if (STATE.activePage) {
      setActivePage(STATE.activePage);
    }
  }

  function createNavButton(label, page, baseClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.navPage = page;
    btn.className = `${baseClass} nav-page-btn nav-page-inactive`;
    btn.textContent = label;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      if (page === 'quote') {
        showQuotePage(null);
      }
    });
    return btn;
  }

  function setNavActive(nav, page) {
    const buttons = Array.from(nav.querySelectorAll('[data-nav-page]'));
    buttons.forEach((btn) => {
      const isActive = btn.dataset.navPage === page;
      btn.classList.toggle('nav-page-active', isActive);
      btn.classList.toggle('nav-page-inactive', !isActive);
    });
  }

  function enhanceSecurityTool() {
    const nav = ROOT.querySelector('nav');
    if (!nav) return;
    if (nav.querySelector('[data-security-tool="true"]')) return;

    const buttons = Array.from(nav.querySelectorAll('button'));
    const logoutBtn = buttons.find((btn) => {
      return btn.textContent && btn.textContent.toLowerCase().includes('salir');
    }) || buttons[buttons.length - 1];

    const tool = document.createElement('button');
    tool.type = 'button';
    tool.dataset.securityTool = 'true';
    tool.className = 'security-tool-nav';
    tool.title = 'Seguridad';
    tool.innerHTML = [
      '<span class="security-tool-gear" aria-hidden="true">',
      '<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.08.09a2 2 0 1 1-2.83 2.83l-.09-.08a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1 1.63V21a2 2 0 1 1-4 0v-.12a1.8 1.8 0 0 0-1-1.63 1.8 1.8 0 0 0-2 .36l-.09.08a2 2 0 1 1-2.83-2.83l.08-.09a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.63-1H3a2 2 0 1 1 0-4h.12a1.8 1.8 0 0 0 1.63-1 1.8 1.8 0 0 0-.36-2l-.08-.09a2 2 0 1 1 2.83-2.83l.09.08a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1-1.63V3a2 2 0 1 1 4 0v.12a1.8 1.8 0 0 0 1 1.63 1.8 1.8 0 0 0 2-.36l.09-.08a2 2 0 1 1 2.83 2.83l-.08.09a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.63 1H21a2 2 0 1 1 0 4h-.12a1.8 1.8 0 0 0-1.63 1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '</span>'
    ].join('');
    tool.addEventListener('click', () => {
      showSecurityPage();
    });

    if (logoutBtn && logoutBtn.parentElement) {
      logoutBtn.parentElement.insertBefore(tool, logoutBtn);
    } else {
      nav.appendChild(tool);
    }
  }

  function ensureModal() {
    if (STATE.modal) return STATE.modal;
    const modal = document.createElement('div');
    modal.className = 'client-modal';
    modal.innerHTML = [
      '<div class="client-modal-card">',
      '  <div class="client-modal-header">',
      '    <div class="client-modal-title">Editar cliente</div>',
      '    <button class="client-modal-close" type="button">x</button>',
      '  </div>',
      '  <form class="client-modal-form">',
      '    <div class="client-modal-row">',
      '      <label>Nombre</label>',
      '      <input name="nombre" type="text" required>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Direccion envio</label>',
      '      <input name="direccionEnvio" type="text" placeholder="Calle 123, Ciudad">',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Fecha registro</label>',
      '      <input name="fechaRegistro" type="date">',
      '    </div>',
      '    <div class="client-modal-actions">',
      '      <button type="button" class="client-modal-cancel">Cancelar</button>',
      '      <button type="submit" class="client-modal-save">Guardar</button>',
      '    </div>',
      '  </form>',
      '</div>',
    ].join('');

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    modal.querySelector('.client-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.client-modal-cancel').addEventListener('click', closeModal);

    bindToggleGroups(modal);

    modal.querySelector('form').addEventListener('submit', handleSave);
    document.body.appendChild(modal);
    STATE.modal = modal;
    return modal;
  }

  function ensureQuotePage() {
    if (STATE.quotePage) return STATE.quotePage;
    const page = document.createElement('section');
    page.className = 'quote-page';
    page.innerHTML = [
      '<div class="quote-page-inner">',
      '  <div class="quote-page-header">',
      '    <div>',
      '      <div class="quote-page-title">Cotizacion</div>',
      '      <div class="quote-page-subtitle">Calcula el total a pagar en USD y VES.</div>',
      '    </div>',
      '    <button class="quote-back-btn" type="button">Volver</button>',
      '  </div>',
      '  <div class="quote-page-card">',
      '    <form class="client-modal-form quote-form">',
      '      <div class="quote-section">',
      '        <div class="quote-section-title">Carrito</div>',
      '        <div class="client-modal-row" data-field="monto-usd">',
      '          <label>Monto del carrito (USD)</label>',
      '          <input name="montoUsd" type="number" step="0.01" min="0" placeholder="0.00">',
      '        </div>',
      '        <div class="client-modal-row" data-field="tasa-row">',
      '          <label>Tasa USDT (Bs/USD)</label>',
      '          <input name="tasa" type="number" step="0.01" min="0" placeholder="Ej: 38.5">',
      '        </div>',
      '      </div>',
      '      <div class="quote-section">',
      '        <div class="quote-section-title">Envio</div>',
      '        <div class="quote-inline" data-field="envio">',
      '          <button type="button" data-value="venezuela">Venezuela</button>',
      '          <button type="button" data-value="personalizado">Personalizado</button>',
      '        </div>',
      '        <div class="client-modal-row" data-field="cantidad">',
      '          <label>Cantidad de productos</label>',
      '          <input name="cantidad" type="number" min="1" step="1" value="1">',
      '        </div>',
      '        <div class="client-modal-row" data-field="envio-custom">',
      '          <label>Costo envio personalizado (USD)</label>',
      '          <input name="envioCustom" type="number" min="0" step="0.01" placeholder="0.00">',
      '        </div>',
      '      </div>',
      '      <div class="quote-result">',
      '        <div class="quote-result-row"><span>Carrito (USD)</span><span data-out="cart-usd">$0.00</span></div>',
      '        <div class="quote-result-row"><span>Envio (USD)</span><span data-out="shipping-usd">$0.00</span></div>',
      '        <div class="quote-result-row"><span>Total (USD)</span><span data-out="total-usd">$0.00</span></div>',
      '        <div class="quote-result-row quote-total"><span>Total (VES)</span><span data-out="total-ves">Bs 0.00</span></div>',
      '        <div class="quote-note">Envio Venezuela: $1.5 por producto, >10 baja a $1, >20 gratis.</div>',
      '      </div>',
      '    </form>',
      '  </div>',
      '</div>',
    ].join('');

    const backBtn = page.querySelector('.quote-back-btn');
    backBtn.addEventListener('click', () => {
      hideQuotePage();
    });

    const shippingGroup = page.querySelector('[data-field="envio"]');

    shippingGroup.addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      const value = btn.getAttribute('data-value');
      if (!value) return;
      setQuoteToggle(shippingGroup, value);
      applyQuoteVisibility(page);
      updateQuote(page);
    });

    page.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => updateQuote(page));
    });

    const nav = ROOT.querySelector('nav');
    if (nav && nav.parentElement) {
      nav.parentElement.insertBefore(page, nav.nextSibling);
    } else {
      ROOT.appendChild(page);
    }

    STATE.quotePage = page;
    return page;
  }

  function ensureSecurityPage() {
    if (STATE.securityPage) return STATE.securityPage;
    const page = document.createElement('section');
    page.className = 'quote-page security-page';
    page.innerHTML = [
      '<div class="quote-page-inner">',
      '  <div class="quote-page-header">',
      '    <div>',
      '      <div class="quote-page-title">Seguridad</div>',
      '      <div class="quote-page-subtitle">Perfil, contrasena y respaldos.</div>',
      '    </div>',
      '    <button class="quote-back-btn" type="button">Volver</button>',
      '  </div>',
      '  <div class="security-grid">',
      '    <div class="quote-page-card security-card">',
      '      <div class="quote-section-title">Perfil</div>',
      '      <form class="client-modal-form security-profile-form">',
      '        <div class="client-modal-row">',
      '          <label>Usuario</label>',
      '          <input name="username" type="text" placeholder="Usuario">',
      '        </div>',
      '        <div class="client-modal-row">',
      '          <label>Nombre visible</label>',
      '          <input name="nombre" type="text" placeholder="Nombre">',
      '        </div>',
      '        <div class="client-modal-row">',
      '          <label>Contrasena actual (para guardar)</label>',
      '          <input name="currentPassword" type="password" placeholder="********">',
      '        </div>',
      '        <div class="security-actions">',
      '          <button type="submit" class="client-modal-save">Guardar perfil</button>',
      '        </div>',
      '      </form>',
      '    </div>',
      '    <div class="quote-page-card security-card">',
      '      <div class="quote-section-title">Cambiar contrasena</div>',
      '      <form class="client-modal-form security-password-form">',
      '        <div class="client-modal-row">',
      '          <label>Contrasena actual</label>',
      '          <input name="currentPassword" type="password" placeholder="********">',
      '        </div>',
      '        <div class="client-modal-row">',
      '          <label>Nueva contrasena</label>',
      '          <input name="newPassword" type="password" placeholder="Minimo 8 caracteres">',
      '        </div>',
      '        <div class="client-modal-row">',
      '          <label>Confirmar contrasena</label>',
      '          <input name="confirmPassword" type="password" placeholder="Repite la contrasena">',
      '        </div>',
      '        <div class="security-actions">',
      '          <button type="submit" class="client-modal-save">Actualizar contrasena</button>',
      '        </div>',
      '      </form>',
      '    </div>',
      '    <div class="quote-page-card security-card security-card-wide">',
      '      <div class="quote-section-title">Respaldos</div>',
      '      <div class="security-backup-actions">',
      '        <button type="button" class="client-modal-save" data-action="backup-create">Crear respaldo</button>',
      '        <button type="button" class="client-modal-cancel" data-action="backup-refresh">Actualizar lista</button>',
      '      </div>',
      '      <div class="backup-list" data-backup-list></div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('');

    page.querySelector('.quote-back-btn').addEventListener('click', () => {
      setActivePage(null);
    });

    const profileForm = page.querySelector('.security-profile-form');
    const passwordForm = page.querySelector('.security-password-form');
    const createBtn = page.querySelector('[data-action="backup-create"]');
    const refreshBtn = page.querySelector('[data-action="backup-refresh"]');

    profileForm.addEventListener('submit', handleProfileSave);
    passwordForm.addEventListener('submit', handlePasswordSave);
    createBtn.addEventListener('click', handleBackupCreate);
    refreshBtn.addEventListener('click', loadBackups);

    const nav = ROOT.querySelector('nav');
    if (nav && nav.parentElement) {
      nav.parentElement.insertBefore(page, nav.nextSibling);
    } else {
      ROOT.appendChild(page);
    }

    STATE.securityPage = page;
    loadProfile();
    loadBackups();
    return page;
  }

  function setToggleGroupState(group, value) {
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll('button'));
    buttons.forEach((btn) => {
      const isActive = btn.getAttribute('data-value') === String(value);
      btn.classList.toggle('is-active', isActive);
    });
    group.dataset.selected = String(value);
  }

  function bindToggleGroups(scope) {
    scope.querySelectorAll('.client-modal-toggle').forEach((group) => {
      if (group.dataset.bound === 'true') return;
      group.dataset.bound = 'true';
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn) return;
        const value = btn.getAttribute('data-value');
        if (value === null) return;
        setToggleGroupState(group, value === 'true');
      });
    });
  }

  function buildFallbackOrder(client) {
    if (!client) return null;
    const hasLegacy =
      (client.enlace && String(client.enlace).trim()) ||
      (client.fechaRegistro && String(client.fechaRegistro).trim()) ||
      (client.direccionEnvio && String(client.direccionEnvio).trim());
    if (!hasLegacy) return null;
    return {
      id: 'legacy-' + String(client.id || Date.now()),
      fecha: client.fechaRegistro || '',
      enlace: client.enlace || '',
      enlaceActualizado: client.enlaceActualizado || '',
      direccionEnvio: client.direccionEnvio || '',
      monto: 0,
      montoOriginal: null,
      descuentoPct: 0,
      descripcion: '',
      pagoCompletado: !!client.pagoCompletado,
      pedidoCompletado: !!client.pedidoCompletado,
      entregado: !!client.entregado,
      createdAt: Date.now()
    };
  }

  function normalizeOrder(order, index) {
    const raw = order || {};
    const id = raw.id !== undefined && raw.id !== null ? String(raw.id) : 'pedido-' + Date.now() + '-' + index;
    const monto = toNumber(raw.monto);
    const montoOriginal = raw.montoOriginal !== undefined && raw.montoOriginal !== null ? toNumber(raw.montoOriginal) : null;
    const descuentoPct = raw.descuentoPct !== undefined && raw.descuentoPct !== null ? toNumber(raw.descuentoPct) : 0;
    let createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : null;
    if (!Number.isFinite(createdAt) && raw.fecha) {
      const parsed = Date.parse(raw.fecha);
      createdAt = Number.isFinite(parsed) ? parsed : null;
    }
    if (!Number.isFinite(createdAt) && id.match(/^\d+$/)) {
      const numeric = Number(id);
      createdAt = Number.isFinite(numeric) ? numeric : null;
    }
    return {
      id,
      fecha: raw.fecha || '',
      enlace: raw.enlace || '',
      enlaceActualizado: raw.enlaceActualizado || '',
      direccionEnvio: raw.direccionEnvio || '',
      monto: Number.isFinite(monto) ? monto : 0,
      montoOriginal: Number.isFinite(montoOriginal) ? montoOriginal : null,
      descuentoPct: Number.isFinite(descuentoPct) ? descuentoPct : 0,
      descripcion: raw.descripcion || '',
      pagoCompletado: !!raw.pagoCompletado,
      pedidoCompletado: !!raw.pedidoCompletado,
      entregado: !!raw.entregado,
      createdAt
    };
  }

  function orderSignature(order) {
    const link = normalizeText(order.enlace || order.enlaceActualizado);
    const date = order.fecha || '';
    const amount = Number.isFinite(order.monto) ? order.monto.toFixed(2) : '0.00';
    const address = normalizeText(order.direccionEnvio);
    return [link, date, amount, address].join('|');
  }

  function mergeOrderDetails(base, incoming) {
    const merged = Object.assign({}, base);
    if (!merged.descripcion && incoming.descripcion) merged.descripcion = incoming.descripcion;
    if (!merged.enlace && incoming.enlace) merged.enlace = incoming.enlace;
    if (!merged.enlaceActualizado && incoming.enlaceActualizado) merged.enlaceActualizado = incoming.enlaceActualizado;
    if (!merged.direccionEnvio && incoming.direccionEnvio) merged.direccionEnvio = incoming.direccionEnvio;
    if (!merged.fecha && incoming.fecha) merged.fecha = incoming.fecha;
    if (!(merged.monto > 0) && incoming.monto > 0) merged.monto = incoming.monto;
    if (merged.montoOriginal === null && incoming.montoOriginal !== null) {
      merged.montoOriginal = incoming.montoOriginal;
    }
    if (!Number.isFinite(merged.createdAt) && Number.isFinite(incoming.createdAt)) {
      merged.createdAt = incoming.createdAt;
    }
    return merged;
  }

  function buildOrdersFromTransactions(client) {
    if (!client || !client.nombre) return [];
    const transactions = loadTransactions();
    if (!Array.isArray(transactions) || transactions.length === 0) return [];
    const target = normalizeText(client.nombre);
    return transactions
      .filter((tx) => {
        if (!tx || !tx.cliente || !tx.tipo) return false;
        if (String(tx.tipo).toLowerCase() !== 'ingreso') return false;
        if (tx.subTipo && String(tx.subTipo).toLowerCase() !== 'venta') return false;
        return normalizeText(tx.cliente) === target;
      })
      .map((tx, index) => {
        const createdAt = Number.isFinite(Number(tx.id)) ? Number(tx.id) : null;
        return {
          id: tx.id !== undefined && tx.id !== null ? String(tx.id) : 'tx-' + index,
          fecha: tx.fecha || '',
          enlace: tx.enlace || '',
          enlaceActualizado: '',
          direccionEnvio: tx.direccionEnvio || '',
          monto: toNumber(tx.monto),
          montoOriginal:
            tx.conversion && tx.conversion.montoOriginal !== undefined
              ? toNumber(tx.conversion.montoOriginal)
              : null,
          descuentoPct: 0,
          descripcion: tx.descripcion || '',
          pagoCompletado: false,
          pedidoCompletado: false,
          entregado: false,
          createdAt
        };
      });
  }

  function collectOrdersForClient(client) {
    const source = Array.isArray(client.pedidos) ? client.pedidos : [];
    let orders = source.map((order, index) => normalizeOrder(order, index));
    const txOrders = buildOrdersFromTransactions(client);
    let usedFallback = false;
    if (orders.length === 0 && txOrders.length === 0) {
      const fallback = buildFallbackOrder(client);
      if (fallback) {
        orders = [normalizeOrder(fallback, 0)];
        usedFallback = true;
      }
    }
    const orderMap = new Map();
    orders.forEach((order) => {
      orderMap.set(orderSignature(order), order);
    });

    txOrders.forEach((order) => {
      const signature = orderSignature(order);
      if (orderMap.has(signature)) {
        orderMap.set(signature, mergeOrderDetails(orderMap.get(signature), order));
        return;
      }
      orderMap.set(signature, order);
    });

    orders = Array.from(orderMap.values());
    return { orders, usedFallback };
  }

  function formatOrderLabel(order, index) {
    const date = order.fecha ? order.fecha : 'sin fecha';
    return 'Pedido ' + (index + 1) + ' · ' + date;
  }

  function formatOrderNotes(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const max = 160;
    if (clean.length <= max) return clean;
    return clean.slice(0, max - 3) + '...';
  }

  function openEditModal(card) {
    const clients = loadClients();
    const client = resolveClientFromCard(clients, card);
    if (!client) return;

    const modal = ensureModal();
    modal.dataset.clientId = client.id !== undefined ? String(client.id) : '';
    modal.dataset.clientIndex = card.dataset.clientIndex || '';

    modal.querySelector('input[name="nombre"]').value = client.nombre || '';
    modal.querySelector('input[name="direccionEnvio"]').value = client.direccionEnvio || '';
    modal.querySelector('input[name="fechaRegistro"]').value = client.fechaRegistro || '';

    modal.classList.add('is-open');
  }

  function ensureOrderModal() {
    if (STATE.orderModal) return STATE.orderModal;
    const modal = document.createElement('div');
    modal.className = 'client-modal order-modal';
    modal.innerHTML = [
      '<div class="client-modal-card order-modal-card">',
      '  <div class="client-modal-header">',
      '    <div class="client-modal-title">Editar pedido</div>',
      '    <button class="client-modal-close" type="button">x</button>',
      '  </div>',
      '  <div class="client-modal-subtitle" data-order-subtitle="true"></div>',
      '  <form class="client-modal-form order-form">',
      '    <div class="client-modal-row">',
      '      <label>Link original</label>',
      '      <input name="orderEnlace" type="url" placeholder="https://...">',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Link actualizado (opcional)</label>',
      '      <input name="orderEnlaceActualizado" type="url" placeholder="https://...">',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Direccion envio</label>',
      '      <input name="orderDireccion" type="text" placeholder="Calle 123, Ciudad">',
      '    </div>',
      '    <div class="client-modal-row two">',
      '      <div>',
      '        <label>Fecha pedido</label>',
      '        <input name="orderFecha" type="date">',
      '      </div>',
      '      <div>',
      '        <label>Monto (USD)</label>',
      '        <input name="orderMonto" type="number" step="0.01" min="0" placeholder="0.00">',
      '      </div>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Descuento aplicado (%)</label>',
      '      <input name="orderDescuento" type="number" step="1" min="0" max="100" placeholder="0">',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Nota (opcional)</label>',
      '      <textarea name="orderNotas" rows="2" placeholder="Notas del pedido..."></textarea>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Estado pago</label>',
      '      <div class="client-modal-toggle" data-field="orderPago">',
      '        <button type="button" data-value="true">Completado</button>',
      '        <button type="button" data-value="false">Pendiente</button>',
      '      </div>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Estado pedido</label>',
      '      <div class="client-modal-toggle" data-field="orderEstado">',
      '        <button type="button" data-value="true">Pedido completado</button>',
      '        <button type="button" data-value="false">Pedido pendiente</button>',
      '      </div>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Logistica</label>',
      '      <div class="client-modal-toggle" data-field="orderEntrega">',
      '        <button type="button" data-value="true">Entregado</button>',
      '        <button type="button" data-value="false">En camino</button>',
      '      </div>',
      '    </div>',
      '    <div class="client-modal-actions">',
      '      <button type="button" class="client-modal-cancel">Cancelar</button>',
      '      <button type="submit" class="client-modal-save">Guardar pedido</button>',
      '    </div>',
      '  </form>',
      '</div>',
    ].join('');

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeOrderModal();
    });

    modal.querySelector('.client-modal-close').addEventListener('click', closeOrderModal);
    modal.querySelector('.client-modal-cancel').addEventListener('click', closeOrderModal);
    bindToggleGroups(modal);
    modal.querySelector('form').addEventListener('submit', handleOrderSave);

    document.body.appendChild(modal);
    STATE.orderModal = modal;
    return modal;
  }

  function openOrderModal(card, orderId) {
    const clients = loadClients();
    const client = resolveClientFromCard(clients, card) || CARD_CLIENT_CACHE.get(card);
    if (!client) return false;

    return openOrderModalWithClient(client, orderId, card);
  }

  function resolveClientFromData(clients, data) {
    if (!data) return null;
    const clientId = data.clientId ? String(data.clientId) : '';
    const clientIndex = data.clientIndex !== undefined && data.clientIndex !== null
      ? Number(data.clientIndex)
      : -1;
    const clientName = data.clientName ? String(data.clientName) : '';
    let client = null;
    if (clientId) {
      client = clients.find((c) => String(c.id) === clientId) || null;
    }
    if (!client && Number.isFinite(clientIndex) && clientIndex >= 0) {
      client = clients[clientIndex] || null;
    }
    if (!client && clientName) {
      const normalized = normalizeText(clientName);
      client = clients.find((c) => c && normalizeText(c.nombre) === normalized) || null;
    }
    return client;
  }

  function openOrderModalFromData(data, orderId) {
    const clients = loadClients();
    const clientId = data && data.clientId ? String(data.clientId) : '';
    const clientIndex = data && data.clientIndex !== undefined && data.clientIndex !== null
      ? Number(data.clientIndex)
      : -1;
    const clientName = data && data.clientName ? String(data.clientName) : '';
    let client = resolveClientFromData(clients, data);
    if (!client) {
      let card = null;
      if (clientId) {
        card = ROOT.querySelector('.client-card[data-client-id="' + clientId + '"]');
      }
      if (!card && clientName) {
        const normalized = normalizeText(clientName);
        card = Array.from(ROOT.querySelectorAll('.client-card')).find((el) => {
          return normalizeText(el.dataset.clientName || '') === normalized;
        }) || null;
      }
      if (!card && Number.isFinite(clientIndex) && clientIndex >= 0) {
        card = ROOT.querySelector('.client-card[data-client-index="' + clientIndex + '"]');
      }
      if (card) {
        const cached = CARD_CLIENT_CACHE.get(card);
        if (cached) {
          client = cached;
        }
      }
    }
    if (!client) return false;
    const fallbackCard = {
      dataset: {
        clientId: clientId || (client.id !== undefined ? String(client.id) : ''),
        clientIndex: Number.isFinite(clientIndex) && clientIndex >= 0 ? String(clientIndex) : '',
        clientName: clientName || (client.nombre || '')
      }
    };
    return openOrderModalWithClient(client, orderId, fallbackCard);
  }

  function openOrderModalWithClient(client, orderId, card) {
    const modal = ensureOrderModal();
    modal.dataset.clientId = client.id !== undefined ? String(client.id) : '';
    modal.dataset.clientIndex = card && card.dataset ? card.dataset.clientIndex || '' : '';

    const data = collectOrdersForClient(client);
    let orders = data.orders;
    if (!orders.length && card && CARD_ORDER_CACHE.has(card)) {
      const cachedOrders = CARD_ORDER_CACHE.get(card);
      if (Array.isArray(cachedOrders) && cachedOrders.length) {
        orders = cachedOrders.slice();
      }
    }
    if (!orders.length) {
      console.error('✗ No hay órdenes para el cliente', { clientId: client.id, clientName: client.nombre });
      return false;
    }
    const index = orderId
      ? orders.findIndex((order) => order.id === orderId)
      : 0;
    const orderIndex = index >= 0 ? index : 0;
    const order = orders[orderIndex];

    modal._orders = orders;
    modal.dataset.orderId = order.id;

    const subtitle = modal.querySelector('[data-order-subtitle="true"]');
    if (subtitle) {
      const sortedIndex = orders
        .slice()
        .sort((a, b) => getOrderSortValue(b) - getOrderSortValue(a))
        .findIndex((item) => item.id === order.id);
      const labelIndex = sortedIndex >= 0 ? sortedIndex : orderIndex;
      subtitle.textContent = (client.nombre || 'Cliente') + ' · ' + formatOrderLabel(order, labelIndex);
    }

    const form = modal.querySelector('form');
    if (!form) {
      modal.classList.add('is-open');
      return true;
    }
    
    // Acceder a los campos de forma más segura
    const getFormInput = (name) => form.querySelector('input[name="' + name + '"], textarea[name="' + name + '"]');
    
    const enlaceInput = getFormInput('orderEnlace');
    const enlaceActualizadoInput = getFormInput('orderEnlaceActualizado');
    const direccionInput = getFormInput('orderDireccion');
    const fechaInput = getFormInput('orderFecha');
    const montoInput = getFormInput('orderMonto');
    const descuentoInput = getFormInput('orderDescuento');
    const notasInput = getFormInput('orderNotas');
    
    if (enlaceInput) enlaceInput.value = order.enlace || '';
    if (enlaceActualizadoInput) enlaceActualizadoInput.value = order.enlaceActualizado || '';
    if (direccionInput) direccionInput.value = order.direccionEnvio || '';
    if (fechaInput) fechaInput.value = order.fecha || '';
    if (montoInput) montoInput.value = Number.isFinite(order.monto) && order.monto > 0 ? order.monto : '';
    if (descuentoInput) descuentoInput.value = order.descuentoPct ? order.descuentoPct : '';
    if (notasInput) notasInput.value = order.descripcion || '';

    setToggleGroupState(modal.querySelector('[data-field="orderPago"]'), !!order.pagoCompletado);
    setToggleGroupState(modal.querySelector('[data-field="orderEstado"]'), !!order.pedidoCompletado);
    setToggleGroupState(modal.querySelector('[data-field="orderEntrega"]'), !!order.entregado);

    console.log('✓ Mostrando modal de edición de pedido', {
      orderId: order.id,
      clientName: client.nombre,
      orderAmount: order.monto,
      orderDate: order.fecha
    });
    modal.classList.add('is-open');
    return true;
  }

  function findClientByOrderId(clients, orderId) {
    if (!orderId) return null;
    return clients.find((client) => {
      const orders = collectOrdersForClient(client).orders;
      return orders.some((order) => order.id === orderId);
    }) || null;
  }

  function openOrderModalByOrderId(orderId) {
    if (!orderId) return false;
    const clients = loadClients();
    const client = findClientByOrderId(clients, orderId);
    if (!client) return false;
    return openOrderModalWithClient(client, orderId, null);
  }

  function closeOrderModal() {
    if (!STATE.orderModal) return;
    STATE.orderModal.classList.remove('is-open');
  }

  function showQuotePage(card) {
    const page = ensureQuotePage();
    const form = page.querySelector('form');

    setQuoteToggle(page.querySelector('[data-field="envio"]'), 'venezuela');
    form.montoUsd.value = form.montoUsd.value || '';
    form.tasa.value = form.tasa.value || '';
    form.cantidad.value = form.cantidad.value || '1';
    form.envioCustom.value = form.envioCustom.value || '';

    applyQuoteVisibility(page);
    updateQuote(page);

    setActivePage('quote');
  }

  function showSecurityPage() {
    ensureSecurityPage();
    loadProfile();
    loadBackups();
    setActivePage('security');
  }

  function closeModal() {
    if (!STATE.modal) return;
    STATE.modal.classList.remove('is-open');
  }

  function hideQuotePage() {
    setActivePage(null);
  }

  function setActivePage(page) {
    const main = ROOT.querySelector('main');
    if (main) {
      main.style.display = page ? 'none' : '';
    }
    if (STATE.quotePage) {
      STATE.quotePage.classList.toggle('is-active', page === 'quote');
    }
    if (STATE.securityPage) {
      STATE.securityPage.classList.toggle('is-active', page === 'security');
    }
    STATE.activePage = page;
    const nav = ROOT.querySelector('nav');
    if (nav) setNavActive(nav, page);
    const tool = document.querySelector('[data-security-tool="true"]');
    if (tool) {
      tool.classList.toggle('is-active', page === 'security');
    }
  }

  function resolveClientFromCard(clients, card) {
    const id = card.dataset.clientId;
    if (id) {
      const found = clients.find((c) => String(c.id) === id);
      if (found) return found;
    }
    const index = Number(card.dataset.clientIndex || -1);
    if (clients[index]) return clients[index];
    let name = card.dataset.clientName || '';
    if (!name) {
      const nameEl = card.querySelector('h3');
      name = nameEl ? nameEl.textContent.trim() : '';
    }
    if (name) {
      const normalized = normalizeText(name);
      const byName = clients.find((c) => c && normalizeText(c.nombre) === normalized);
      if (byName) return byName;
    }
    const cached = CARD_CLIENT_CACHE.get(card);
    if (cached) return cached;
    return null;
  }

  function getOrderSortValue(order) {
    if (order && Number.isFinite(order.createdAt)) return order.createdAt;
    if (order && order.fecha) {
      const parsed = Date.parse(order.fecha);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (order && order.id && String(order.id).match(/^\d+$/)) {
      const numeric = Number(order.id);
      if (Number.isFinite(numeric)) return numeric;
    }
    return 0;
  }

  function getLatestOrder(orders) {
    if (!Array.isArray(orders) || orders.length === 0) return null;
    return orders.reduce((latest, order) => {
      if (!latest) return order;
      return getOrderSortValue(order) >= getOrderSortValue(latest) ? order : latest;
    }, orders[0]);
  }

  function applyClientLatestFromOrders(client, orders) {
    const updated = Object.assign({}, client, { pedidos: orders });
    const latest = getLatestOrder(orders);
    if (!latest) return updated;
    updated.ultimoPedidoId = latest.id;
    updated.pagoCompletado = !!latest.pagoCompletado;
    updated.pedidoCompletado = !!latest.pedidoCompletado;
    updated.entregado = !!latest.entregado;
    const latestLink = latest.enlaceActualizado || latest.enlace;
    if (latestLink) {
      updated.enlace = latestLink;
      updated.enlaceActualizado = latest.enlaceActualizado || '';
    }
    if (latest.direccionEnvio) {
      updated.direccionEnvio = latest.direccionEnvio;
    }
    if (!updated.fechaRegistro && latest.fecha) {
      updated.fechaRegistro = latest.fecha;
    }
    return updated;
  }

  function handleSave(event) {
    event.preventDefault();
    const modal = STATE.modal;
    if (!modal) return;
    const clients = loadClients();

    const id = modal.dataset.clientId;
    let index = -1;
    if (id) {
      index = clients.findIndex((c) => String(c.id) === id);
    }
    if (index < 0) {
      index = Number(modal.dataset.clientIndex || -1);
    }
    if (index < 0 || !clients[index]) {
      closeModal();
      return;
    }

    const form = modal.querySelector('form');
    const updated = Object.assign({}, clients[index], {
      nombre: form.nombre.value.trim(),
      direccionEnvio: form.direccionEnvio.value.trim(),
      fechaRegistro: form.fechaRegistro.value,
    });

    clients[index] = updated;
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
    syncClientsAndReload(clients).then((ok) => {
      if (ok) {
        showToast('Se guardo correctamente', 'success');
        closeModal();
        setTimeout(() => window.location.reload(), 800);
        return;
      }
      showToast('No se pudo guardar. Revisa conexion o sesion.', 'error');
    });
  }

  function handleOrderSave(event) {
    event.preventDefault();
    const modal = STATE.orderModal;
    if (!modal) return;
    const clients = loadClients();

    const id = modal.dataset.clientId;
    let index = -1;
    if (id) {
      index = clients.findIndex((c) => String(c.id) === id);
    }
    if (index < 0) {
      index = Number(modal.dataset.clientIndex || -1);
    }
    if (index < 0 || !clients[index]) {
      closeOrderModal();
      return;
    }

    const form = modal.querySelector('form');
    const orders = Array.isArray(modal._orders)
      ? modal._orders.map((order, idx) => normalizeOrder(order, idx))
      : collectOrdersForClient(clients[index]).orders;
    if (!orders.length) {
      closeOrderModal();
      return;
    }

    const orderId = modal.dataset.orderId || '';
    let orderIndex = orders.findIndex((order) => order.id === orderId);
    if (orderIndex < 0) orderIndex = 0;

    // Acceder a los campos de forma más segura
    const getFormInput = (name) => form.querySelector('input[name="' + name + '"], textarea[name="' + name + '"]');
    
    const descuentoInput = getFormInput('orderDescuento');
    const montoInput = getFormInput('orderMonto');
    const enlaceInput = getFormInput('orderEnlace');
    const enlaceActualizadoInput = getFormInput('orderEnlaceActualizado');
    const direccionInput = getFormInput('orderDireccion');
    const fechaInput = getFormInput('orderFecha');
    const notasInput = getFormInput('orderNotas');

    const descuentoPct = toNumber(descuentoInput ? descuentoInput.value : '0');
    const monto = toNumber(montoInput ? montoInput.value : '0');
    const hasDiscount = descuentoPct > 0 && descuentoPct < 100 && monto > 0;
    const enlaceOriginal = enlaceInput ? enlaceInput.value.trim() : '';
    const enlaceActualizado = enlaceActualizadoInput ? enlaceActualizadoInput.value.trim() : '';
    const updatedOrder = Object.assign({}, orders[orderIndex], {
      enlace: enlaceOriginal,
      enlaceActualizado: enlaceActualizado,
      direccionEnvio: direccionInput ? direccionInput.value.trim() : '',
      fecha: fechaInput ? fechaInput.value : '',
      monto,
      descuentoPct: hasDiscount ? descuentoPct : 0,
      montoOriginal: hasDiscount ? monto / (1 - descuentoPct / 100) : null,
      descripcion: notasInput ? notasInput.value.trim() : '',
      pagoCompletado: modal.querySelector('[data-field="orderPago"]').dataset.selected === 'true',
      pedidoCompletado: modal.querySelector('[data-field="orderEstado"]').dataset.selected === 'true',
      entregado: modal.querySelector('[data-field="orderEntrega"]').dataset.selected === 'true',
      createdAt: orders[orderIndex].createdAt || Date.now()
    });

    orders[orderIndex] = updatedOrder;

    const updatedClient = applyClientLatestFromOrders(clients[index], orders);
    clients[index] = updatedClient;
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));

    syncClientsAndReload(clients).then((ok) => {
      if (ok) {
        showToast('Pedido actualizado', 'success');
        closeOrderModal();
        setTimeout(() => window.location.reload(), 800);
        return;
      }
      showToast('No se pudo guardar el pedido.', 'error');
    });
  }

  function syncClientsAndReload(clients) {
    const saver =
      typeof window !== 'undefined' &&
      window.appDB &&
      typeof window.appDB.save === 'function'
        ? window.appDB.save(CLIENTS_KEY, clients)
        : null;

    if (saver && typeof saver.then === 'function') {
      return saver
        .then((res) => !!(res && res.ok !== false))
        .catch(() => false);
    }

    return Promise.resolve(false);
  }

  function syncClients(clients) {
    const saver =
      typeof window !== 'undefined' &&
      window.appDB &&
      typeof window.appDB.save === 'function'
        ? window.appDB.save(CLIENTS_KEY, clients)
        : null;

    if (saver && typeof saver.then === 'function') {
      return saver
        .then((res) => !!(res && res.ok !== false))
        .catch(() => false);
    }

    return Promise.resolve(false);
  }

  function ensureToastHost() {
    if (STATE.toastHost) return STATE.toastHost;
    const host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
    STATE.toastHost = host;
    return host;
  }

  function showToast(message, type) {
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type || 'success'}`;
    toast.textContent = message;
    host.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-visible');
    }, 10);
    setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 1600);
    setTimeout(() => {
      toast.remove();
    }, 2100);
  }

  async function apiJson(path, options) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      (options && options.headers) || {}
    );
    const opts = Object.assign({ credentials: 'same-origin' }, options || {}, { headers });
    const res = await fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  async function loadProfile() {
    if (!STATE.securityPage) return;
    const profileForm = STATE.securityPage.querySelector('.security-profile-form');
    if (!profileForm) return;
    const res = await apiJson('/api/profile', { method: 'GET' });
    if (!res.ok || !res.data || !res.data.profile) {
      return;
    }
    profileForm.username.value = res.data.profile.username || '';
    profileForm.nombre.value = res.data.profile.nombre || '';
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      username: form.username.value.trim(),
      nombre: form.nombre.value.trim(),
      currentPassword: form.currentPassword.value
    };

    if (!payload.currentPassword) {
      showToast('Necesitas tu contrasena actual.', 'error');
      return;
    }

    const res = await apiJson('/api/profile', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.ok && res.data && res.data.ok) {
      showToast('Perfil actualizado', 'success');
      form.currentPassword.value = '';
      return;
    }
    const message = res.data && res.data.error ? res.data.error : 'No se pudo guardar';
    showToast(message, 'error');
  }

  async function handlePasswordSave(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      currentPassword: form.currentPassword.value,
      newPassword: form.newPassword.value,
      confirmPassword: form.confirmPassword.value
    };

    const res = await apiJson('/api/change-password', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.ok && res.data && res.data.ok) {
      showToast('Contrasena actualizada', 'success');
      form.reset();
      return;
    }
    const message = res.data && res.data.error ? res.data.error : 'No se pudo actualizar';
    showToast(message, 'error');
  }

  async function handleBackupCreate() {
    const res = await apiJson('/api/backup-create', { method: 'POST' });
    if (res.ok && res.data && res.data.ok) {
      showToast('Respaldo creado: ' + res.data.file, 'success');
      loadBackups();
      return;
    }
    const message = res.data && res.data.error ? res.data.error : 'No se pudo crear respaldo';
    showToast(message, 'error');
  }

  async function loadBackups() {
    if (!STATE.securityPage) return;
    const listEl = STATE.securityPage.querySelector('[data-backup-list]');
    if (!listEl) return;
    const res = await apiJson('/api/backups', { method: 'GET' });
    if (!res.ok || !res.data) {
      listEl.innerHTML = '<div class="backup-empty">No se pudo cargar.</div>';
      return;
    }
    renderBackupList(listEl, res.data.files || []);
  }

  function renderBackupList(container, files) {
    if (!Array.isArray(files) || files.length === 0) {
      container.innerHTML = '<div class="backup-empty">Sin respaldos.</div>';
      return;
    }
    const rows = files.map((file) => {
      const name = file.name || '';
      const size = formatBytes(file.size || 0);
      const date = file.modified ? formatDate(file.modified) : '';
      const link = '/api/backup-download?file=' + encodeURIComponent(name);
      return [
        '<div class="backup-item">',
        '  <div class="backup-meta">',
        '    <div class="backup-name">' + name + '</div>',
        '    <div class="backup-info">' + size + ' • ' + date + '</div>',
        '  </div>',
        '  <a class="backup-download" href="' + link + '" target="_blank" rel="noopener">Descargar</a>',
        '</div>'
      ].join('');
    });
    container.innerHTML = rows.join('');
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }

  function enhanceLoginRecovery() {
    const loginForm = findLoginForm();
    if (!loginForm) return;
    if (loginForm.querySelector('[data-forgot-link="true"]')) return;

    const link = document.createElement('button');
    link.type = 'button';
    link.dataset.forgotLink = 'true';
    link.className = 'forgot-link';
    link.textContent = '¿Olvidaste tu contrasena?';
    link.addEventListener('click', async () => {
      const usernameInput = loginForm.querySelector('input[type="text"]');
      const username = usernameInput ? usernameInput.value.trim() : '';
      const res = await apiJson('/api/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      if (res.ok && res.data && res.data.ok) {
        showToast('Si el usuario existe, enviamos el enlace al correo.', 'success');
        return;
      }
      showToast('No se pudo enviar el enlace.', 'error');
    });

    loginForm.appendChild(link);
  }

  function findLoginForm() {
    const forms = Array.from(ROOT.querySelectorAll('form'));
    return forms.find((form) => {
      const password = form.querySelector('input[type="password"]');
      const submit = form.querySelector('button[type="submit"]');
      return password && submit;
    }) || null;
  }

  function setQuoteToggle(group, value) {
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll('button'));
    buttons.forEach((btn) => {
      const isActive = btn.getAttribute('data-value') === value;
      btn.classList.toggle('is-active', isActive);
    });
    group.dataset.selected = value;
  }

  function applyQuoteVisibility(modal) {
    const shipping = modal.querySelector('[data-field="envio"]').dataset.selected || 'venezuela';

    const tasaRow = modal.querySelector('[data-field="tasa-row"]');
    const qtyRow = modal.querySelector('[data-field="cantidad"]');
    const customRow = modal.querySelector('[data-field="envio-custom"]');

    if (tasaRow) tasaRow.style.display = 'grid';
    if (qtyRow) qtyRow.style.display = shipping === 'venezuela' ? 'grid' : 'none';
    if (customRow) customRow.style.display = shipping === 'personalizado' ? 'grid' : 'none';
  }

  function updateQuote(modal) {
    const form = modal.querySelector('form');
    const shipping = modal.querySelector('[data-field="envio"]').dataset.selected || 'venezuela';

    const rate = toNumber(form.tasa.value);
    const cartUsd = toNumber(form.montoUsd.value);

    let shippingUsd = 0;
    if (shipping === 'venezuela') {
      const qty = Math.max(0, Math.floor(toNumber(form.cantidad.value)));
      let perUnit = 1.5;
      if (qty > 20) perUnit = 0;
      else if (qty > 10) perUnit = 1;
      shippingUsd = qty * perUnit;
    } else {
      shippingUsd = toNumber(form.envioCustom.value);
    }

    const totalUsd = cartUsd + shippingUsd;
    const totalVes = rate > 0 ? totalUsd * rate : 0;

    setQuoteValue(modal, 'cart-usd', formatUsd(cartUsd));
    setQuoteValue(modal, 'shipping-usd', formatUsd(shippingUsd));
    setQuoteValue(modal, 'total-usd', formatUsd(totalUsd));
    setQuoteValue(modal, 'total-ves', formatVes(totalVes));
  }

  function setQuoteValue(modal, key, value) {
    const el = modal.querySelector('[data-out="' + key + '"]');
    if (el) el.textContent = value;
  }

  function toNumber(value) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  }

  function formatUsd(value) {
    return '$' + value.toFixed(2);
  }

  function formatVes(value) {
    return 'Bs ' + value.toFixed(2);
  }

  function enhanceClientPicker() {
    const form = findMovementForm();
    if (!form) return;

    let picker = form.querySelector('[' + CLIENT_PICKER_ATTR + '="true"]');
    if (!picker) {
      picker = buildClientPicker();
      insertClientPicker(form, picker);
    }

    const select = picker.querySelector('select');
    refreshClientPickerOptions(select, loadClients());
    updateClientPickerVisibility(form);

    if (form.dataset.clientPickerBound !== 'true') {
      form.dataset.clientPickerBound = 'true';
      form.addEventListener('click', () => updateClientPickerVisibility(form));
      form.addEventListener('change', () => updateClientPickerVisibility(form));
      form.addEventListener(
        'submit',
        () => handleClientOrderSubmit(form),
        true
      );
    }

    if (picker.dataset.bound !== 'true') {
      picker.dataset.bound = 'true';
      const clearBtn = picker.querySelector('.client-picker-clear');
      if (select) {
        select.addEventListener('change', () => {
          const clients = loadClients();
          const value = select.value;
          form.dataset.selectedClientValue = value;
          if (!value) return;
          const client = resolveClientByPickerValue(clients, value);
          if (client) {
            form.dataset.selectedClientName = client.nombre || '';
            applyClientToForm(form, client);
          }
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          clearClientSelection(form, select);
        });
      }
    }
  }

  function buildClientPicker() {
    const wrapper = document.createElement('div');
    wrapper.setAttribute(CLIENT_PICKER_ATTR, 'true');
    wrapper.className = 'client-picker';
    wrapper.innerHTML = [
      '<label class="client-picker-label">Cliente fijo</label>',
      '<div class="client-picker-controls">',
      '  <select class="client-picker-select"></select>',
      '  <button type="button" class="client-picker-clear">Limpiar</button>',
      '</div>',
      '<div class="client-picker-hint">Selecciona un cliente guardado para autollenar el formulario.</div>'
    ].join('');
    return wrapper;
  }

  function insertClientPicker(form, picker) {
    const nameInput = findClientNameInput(form);
    const grid = nameInput ? nameInput.closest('.grid') : null;
    if (grid && grid.parentElement) {
      grid.parentElement.insertBefore(picker, grid);
      return;
    }
    form.insertBefore(picker, form.firstChild);
  }

  function refreshClientPickerOptions(select, clients) {
    if (!select) return;
    const currentValue = select.value || '';
    select.innerHTML = '';
    const base = document.createElement('option');
    base.value = '';
    base.textContent = 'Selecciona cliente...';
    select.appendChild(base);
    clients.forEach((client, index) => {
      if (!client || !client.nombre) return;
      const opt = document.createElement('option');
      const value = client.id !== undefined ? String(client.id) : 'idx:' + index;
      opt.value = value;
      opt.textContent = client.nombre;
      select.appendChild(opt);
    });
    const stillExists = Array.from(select.options).some((opt) => opt.value === currentValue);
    select.value = stillExists ? currentValue : '';
  }

  function updateClientPickerVisibility(form) {
    const picker = form.querySelector('[' + CLIENT_PICKER_ATTR + '="true"]');
    if (!picker) return;
    picker.style.display = isIngresoClientePedido(form) ? 'grid' : 'none';
  }

  function clearClientSelection(form, select) {
    form.dataset.selectedClientValue = '';
    form.dataset.selectedClientName = '';
    if (select) select.value = '';
  }

  function resolveClientByPickerValue(clients, value) {
    if (!value) return null;
    if (value.startsWith('idx:')) {
      const idx = Number(value.slice(4));
      return Number.isFinite(idx) && clients[idx] ? clients[idx] : null;
    }
    return clients.find((client) => String(client.id) === value) || null;
  }

  function resolveClientFromSelection(form, clients) {
    const value = form.dataset.selectedClientValue || '';
    if (value) {
      const byValue = resolveClientByPickerValue(clients, value);
      if (byValue) return byValue;
    }
    const nameInput = findClientNameInput(form);
    const nameValue = nameInput ? nameInput.value.trim() : '';
    if (!nameValue) return null;
    const normalized = normalizeText(nameValue);
    return clients.find((client) => normalizeText(client.nombre) === normalized) || null;
  }

  function applyClientToForm(form, client) {
    const nameInput = findClientNameInput(form);
    if (nameInput) {
      setNativeValue(nameInput, client.nombre || '');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const addressInput = findAddressInput(form);
    if (addressInput && client.direccionEnvio) {
      setNativeValue(addressInput, client.direccionEnvio || '');
      addressInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const linkInput = findClientLinkInput(form);
    if (linkInput) {
      setNativeValue(linkInput, '');
      linkInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function handleClientOrderSubmit(form) {
    updateClientPickerVisibility(form);
    if (!isIngresoClientePedido(form)) return;
    const clients = loadClients();
    if (!clients.length) return;
    const client = resolveClientFromSelection(form, clients);
    if (!client) return;
    const order = buildOrderFromForm(form);
    if (!order) return;

    let index = clients.findIndex((c) => String(c.id) === String(client.id));
    if (index < 0) {
      const normalized = normalizeText(client.nombre);
      index = clients.findIndex((c) => normalizeText(c.nombre) === normalized);
    }
    if (index < 0) return;

    const updated = applyOrderToClient(clients[index], order, form);
    clients[index] = updated;
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
    syncClients(clients);

    const picker = form.querySelector('[' + CLIENT_PICKER_ATTR + '="true"]');
    const select = picker ? picker.querySelector('select') : null;
    clearClientSelection(form, select);
  }

  function applyOrderToClient(client, order, form) {
    const orders = Array.isArray(client.pedidos) ? client.pedidos.slice() : [];
    orders.unshift(order);

    const nameInput = findClientNameInput(form);
    const nombre = nameInput ? nameInput.value.trim() : client.nombre;

    const updated = Object.assign({}, client, {
      nombre: nombre || client.nombre,
    });

    return applyClientLatestFromOrders(updated, orders);
  }

  function buildOrderFromForm(form) {
    const amountInput = findAmountInput(form);
    if (!amountInput) return null;
    let amount = toNumber(amountInput.value);
    if (!isUsdActive(form)) {
      const rateInput = findRateInput(form);
      const rate = rateInput ? toNumber(rateInput.value) : 0;
      amount = rate > 0 ? amount / rate : 0;
    }
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const linkInput = findClientLinkInput(form);
    const addressInput = findAddressInput(form);
    const descInput = findDescriptionInput(form);
    const dateInput = form.querySelector('input[type="date"]');
    const discountInput = form.querySelector('[data-discount-row="true"] input');
    const descuentoPct = discountInput ? toNumber(discountInput.value) : 0;
    const hasDiscount = descuentoPct > 0 && descuentoPct < 100;
    const montoOriginal = hasDiscount ? amount / (1 - descuentoPct / 100) : null;

    return {
      id: String(Date.now()),
      fecha: dateInput && dateInput.value ? dateInput.value : new Date().toISOString().split('T')[0],
      enlace: linkInput ? linkInput.value.trim() : '',
      enlaceActualizado: '',
      direccionEnvio: addressInput ? addressInput.value.trim() : '',
      monto: amount,
      montoOriginal: hasDiscount ? montoOriginal : null,
      descuentoPct: hasDiscount ? descuentoPct : 0,
      descripcion: descInput ? descInput.value.trim() : '',
      pagoCompletado: false,
      pedidoCompletado: false,
      entregado: false,
      createdAt: Date.now()
    };
  }

  function findClientNameInput(form) {
    const byLabel = findInputByLabel(form, ['cliente', 'concepto']);
    if (byLabel) return byLabel;
    const byPlaceholder = findInputByPlaceholder(form, ['maria', 'cliente', 'concepto']);
    return byPlaceholder;
  }

  function findClientLinkInput(form) {
    const byLabel = findInputByLabel(form, ['link', 'pedido']);
    if (byLabel) return byLabel;
    return form.querySelector('input[type="url"]') || null;
  }

  function findAddressInput(form) {
    const byLabel = findInputByLabel(form, ['direccion', 'envio']);
    if (byLabel) return byLabel;
    const byPlaceholder = findInputByPlaceholder(form, ['calle', 'ciudad']);
    return byPlaceholder;
  }

  function findDescriptionInput(form) {
    const byLabel = findInputByLabel(form, ['descripcion']);
    if (byLabel) return byLabel;
    const byPlaceholder = findInputByPlaceholder(form, ['descripcion']);
    return byPlaceholder;
  }

  function findRateInput(form) {
    const spans = Array.from(form.querySelectorAll('span'));
    const label = spans.find((span) => normalizeText(span.textContent).includes('tasa'));
    if (label && label.parentElement) {
      const input = label.parentElement.querySelector('input[type="number"]');
      if (input) return input;
    }
    return form.querySelector('input[placeholder="38.5"]');
  }

  function findInputByLabel(form, keywords) {
    const labels = Array.from(form.querySelectorAll('label'));
    for (const label of labels) {
      const text = normalizeText(label.textContent);
      if (keywords.some((keyword) => text.includes(keyword))) {
        const wrapper = label.parentElement;
        if (!wrapper) continue;
        const input = wrapper.querySelector('input, textarea');
        if (input) return input;
      }
    }
    return null;
  }

  function findInputByPlaceholder(form, keywords) {
    const inputs = Array.from(form.querySelectorAll('input, textarea'));
    for (const input of inputs) {
      const text = normalizeText(input.getAttribute('placeholder') || '');
      if (keywords.some((keyword) => text.includes(keyword))) {
        return input;
      }
    }
    return null;
  }

  function enhanceHistoryEdit() {
    const tables = findHistoryTables();
    if (tables.length === 0) return;
    const transactions = loadTransactions();

    tables.forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      rows.forEach((row, index) => {
        const tx = transactions[index];
        if (!tx) return;
        enhanceHistoryRow(row, index);
      });
    });
  }

  function findHistoryTables() {
    const tables = Array.from(ROOT.querySelectorAll('table'));
    return tables.filter((table) => {
      const headers = Array.from(table.querySelectorAll('thead th'))
        .map((th) => (th.textContent || '').trim().toLowerCase());
      return headers.includes('acciones') && headers.includes('monto');
    });
  }

  function enhanceHistoryRow(row, index) {
    if (!(row instanceof HTMLElement)) return;
    const actionsCell = row.querySelector('td:last-child');
    if (!actionsCell) return;
    if (actionsCell.querySelector('[data-history-edit="true"]')) return;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.dataset.historyEdit = 'true';
    editBtn.className = 'history-edit-btn';
    editBtn.title = 'Editar';
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openHistoryModal(index);
    });

    actionsCell.prepend(editBtn);
  }

  function ensureHistoryModal() {
    if (STATE.historyModal) return STATE.historyModal;
    const modal = document.createElement('div');
    modal.className = 'client-modal history-modal';
    modal.innerHTML = [
      '<div class="client-modal-card history-modal-card">',
      '  <div class="client-modal-header">',
      '    <div class="client-modal-title">Editar registro</div>',
      '    <button class="client-modal-close" type="button">x</button>',
      '  </div>',
      '  <form class="client-modal-form history-form">',
      '    <div class="client-modal-row two">',
      '      <div>',
      '        <label>Tipo</label>',
      '        <select name="tipo">',
      '          <option value="ingreso">Ingreso</option>',
      '          <option value="inversion_producto">Inversion</option>',
      '          <option value="gasto_envio">Envio</option>',
      '        </select>',
      '      </div>',
      '      <div data-field="subtipo-row">',
      '        <label>Subtipo (Ingreso)</label>',
      '        <select name="subTipo">',
      '          <option value="venta">Venta</option>',
      '          <option value="otro">Otro</option>',
      '        </select>',
      '      </div>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Concepto / Cliente</label>',
      '      <input name="cliente" type="text" placeholder="Nombre o concepto">',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Link / Detalle</label>',
      '      <input name="enlace" type="text" placeholder="https://...">',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Direccion envio</label>',
      '      <input name="direccionEnvio" type="text" placeholder="Calle 123, Ciudad">',
      '    </div>',
      '    <div class="client-modal-row two">',
      '      <div>',
      '        <label>Monto (USD)</label>',
      '        <input name="monto" type="number" step="0.01" min="0" placeholder="0.00">',
      '      </div>',
      '      <div>',
      '        <label>Fecha</label>',
      '        <input name="fecha" type="date">',
      '      </div>',
      '    </div>',
      '    <div class="client-modal-row">',
      '      <label>Descripcion</label>',
      '      <textarea name="descripcion" rows="3" placeholder="Descripcion adicional..."></textarea>',
      '    </div>',
      '    <div class="client-modal-actions">',
      '      <button type="button" class="client-modal-cancel">Cancelar</button>',
      '      <button type="submit" class="client-modal-save">Guardar</button>',
      '    </div>',
      '  </form>',
      '</div>',
    ].join('');

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeHistoryModal();
    });
    modal.querySelector('.client-modal-close').addEventListener('click', closeHistoryModal);
    modal.querySelector('.client-modal-cancel').addEventListener('click', closeHistoryModal);

    modal.querySelector('select[name="tipo"]').addEventListener('change', () => {
      applyHistoryVisibility(modal);
    });

    modal.querySelector('form').addEventListener('submit', handleHistorySave);
    document.body.appendChild(modal);
    STATE.historyModal = modal;
    return modal;
  }

  function openHistoryModal(index) {
    const transactions = loadTransactions();
    const tx = transactions[index];
    if (!tx) return;

    const modal = ensureHistoryModal();
    modal.dataset.txIndex = String(index);

    const form = modal.querySelector('form');
    form.tipo.value = tx.tipo || 'ingreso';
    form.subTipo.value = tx.subTipo || 'venta';
    form.cliente.value = tx.cliente || '';
    form.enlace.value = tx.enlace || '';
    form.direccionEnvio.value = tx.direccionEnvio || '';
    form.monto.value = Number.isFinite(tx.monto) ? tx.monto : '';
    form.fecha.value = tx.fecha || '';
    form.descripcion.value = tx.descripcion || '';

    applyHistoryVisibility(modal);
    modal.classList.add('is-open');
  }

  function closeHistoryModal() {
    if (!STATE.historyModal) return;
    STATE.historyModal.classList.remove('is-open');
  }

  function applyHistoryVisibility(modal) {
    const tipo = modal.querySelector('select[name="tipo"]').value;
    const subRow = modal.querySelector('[data-field="subtipo-row"]');
    if (subRow) subRow.style.display = tipo === 'ingreso' ? 'grid' : 'none';
  }

  function handleHistorySave(event) {
    event.preventDefault();
    const modal = STATE.historyModal;
    if (!modal) return;
    const transactions = loadTransactions();
    const index = Number(modal.dataset.txIndex);
    if (!Number.isFinite(index) || !transactions[index]) {
      closeHistoryModal();
      return;
    }

    const form = modal.querySelector('form');
    const updated = Object.assign({}, transactions[index], {
      tipo: form.tipo.value,
      subTipo: form.subTipo.value,
      cliente: form.cliente.value.trim(),
      enlace: form.enlace.value.trim(),
      direccionEnvio: form.direccionEnvio.value.trim(),
      monto: toNumber(form.monto.value),
      fecha: form.fecha.value,
      descripcion: form.descripcion.value.trim(),
    });

    transactions[index] = updated;
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(transactions));
    closeHistoryModal();
    syncHistoryAndReload(transactions);
  }

  function syncHistoryAndReload(transactions) {
    const saver =
      typeof window !== 'undefined' &&
      window.appDB &&
      typeof window.appDB.save === 'function'
        ? window.appDB.save(TRANSACTIONS_KEY, transactions)
        : null;

    if (saver && typeof saver.then === 'function') {
      saver
        .catch(() => {})
        .finally(() => window.location.reload());
      return;
    }

    // Espera el flush del bridge si existe.
    setTimeout(() => window.location.reload(), 1400);
  }

  function enhanceDiscountField() {
    const form = findMovementForm();
    if (!form) return;

    const amountInput = findAmountInput(form);
    if (!amountInput) return;

    const amountBlock = findAmountBlock(amountInput);
    if (!amountBlock) return;

    if (!amountBlock.querySelector('[data-discount-row="true"]')) {
      const row = document.createElement('div');
      row.dataset.discountRow = 'true';
      row.className = 'discount-row';
      row.innerHTML = [
        '<label class="text-xs font-bold text-gray-400 uppercase block mb-1">Porcentaje a restar (opcional)</label>',
        '<input type="number" min="0" max="100" step="1" placeholder="Ej: 50" class="w-full p-2 border rounded-lg bg-gray-50">',
        '<div class="discount-help">Se descuenta del monto USD antes de guardar.</div>',
      ].join('');
      amountBlock.appendChild(row);
    }

    updateDiscountVisibility(form);

    if (form.dataset.discountBound !== 'true') {
      form.dataset.discountBound = 'true';
      form.addEventListener(
        'submit',
        () => applyDiscountBeforeSubmit(form),
        true
      );
    }
  }

  function findMovementForm() {
    const forms = Array.from(ROOT.querySelectorAll('form'));
    return forms.find((form) => {
      const submit = form.querySelector('button[type="submit"]');
      if (!submit) return false;
      const text = submit.textContent ? submit.textContent.toLowerCase() : '';
      return text.includes('guardar');
    }) || null;
  }

  function findAmountInput(form) {
    const preferred = form.querySelector('input[type="number"].text-xl');
    if (preferred) return preferred;
    const all = Array.from(form.querySelectorAll('input[type="number"][step="0.01"]'));
    return all.length > 0 ? all[0] : null;
  }

  function findAmountBlock(input) {
    let node = input.closest('div');
    while (node && !(node.classList.contains('bg-gray-50') && node.classList.contains('rounded-xl'))) {
      node = node.parentElement;
    }
    return node;
  }

  function updateDiscountVisibility(form) {
    const row = form.querySelector('[data-discount-row="true"]');
    if (!row) return;
    row.style.display = isIngresoClientePedido(form) ? 'block' : 'none';
  }

  function isIngresoClientePedido(form) {
    const ingresoBtn = findButtonByText(form, 'ingreso');
    const clienteBtn = findButtonByText(form, 'cliente');
    const ingresoActive = ingresoBtn ? ingresoBtn.classList.contains('bg-black') : false;
    const clienteActive = clienteBtn
      ? clienteBtn.classList.contains('bg-white') || clienteBtn.classList.contains('shadow')
      : false;
    return ingresoActive && clienteActive;
  }

  function isUsdActive(form) {
    const usdBtn = findButtonByText(form, 'usd');
    return usdBtn ? usdBtn.classList.contains('bg-white') || usdBtn.classList.contains('shadow') : false;
  }

  function findButtonByText(scope, text) {
    const buttons = Array.from(scope.querySelectorAll('button'));
    const lower = text.toLowerCase();
    return buttons.find((btn) => {
      const label = btn.textContent ? btn.textContent.toLowerCase() : '';
      return label.includes(lower);
    }) || null;
  }

  function applyDiscountBeforeSubmit(form) {
    updateDiscountVisibility(form);
    if (!isIngresoClientePedido(form)) return;
    if (!isUsdActive(form)) return;

    const row = form.querySelector('[data-discount-row="true"]');
    if (!row) return;
    const input = row.querySelector('input');
    if (!input) return;
    const pct = toNumber(input.value);
    if (!(pct > 0)) return;

    const amountInput = findAmountInput(form);
    if (!amountInput) return;
    const amount = toNumber(amountInput.value);
    if (!(amount > 0)) return;

    const discounted = Math.max(0, amount - amount * (pct / 100));
    setNativeValue(amountInput, discounted.toFixed(2));
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setNativeValue(element, value) {
    const { set: valueSetter } = Object.getOwnPropertyDescriptor(element, 'value') || {};
    const prototype = Object.getPrototypeOf(element);
    const { set: prototypeSetter } = Object.getOwnPropertyDescriptor(prototype, 'value') || {};
    if (prototypeSetter && valueSetter !== prototypeSetter) {
      prototypeSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(ROOT, { childList: true, subtree: true });
  window.addEventListener('resize', () => {
    document.querySelectorAll('.client-card').forEach((card) => updateDetailsHeight(card));
  });

  scheduleEnhance();
})();
