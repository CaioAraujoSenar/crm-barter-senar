/**
 * fixes.js — Correções de interação + logo SENAR
 * Carregar DEPOIS do script principal, logo antes de </body>:
 *   <script src="fixes.js"></script>
 */
(function () {
  'use strict';

  /* ---------- 1. LOGO SENAR NO CABEÇALHO + FAVICON ---------- */
  const LOGO = 'senar-logo.png';
  const iconBox = document.querySelector('header .w-12.h-12');
  if (iconBox) {
    iconBox.className = 'h-14 w-14 sm:h-16 sm:w-16 rounded-xl bg-white shadow-md flex items-center justify-center shrink-0 p-1.5';
    iconBox.innerHTML = '<img src="' + LOGO + '" alt="SENAR" class="h-full w-full object-contain">';
  }
  const fav = document.createElement('link');
  fav.rel = 'icon';
  fav.href = LOGO;
  document.head.appendChild(fav);

  /* ---------- 2. AVISOS DE ERRO VISÍVEIS (ajuda a diagnosticar) ---------- */
  window.addEventListener('error', function (e) {
    if (typeof showToast === 'function') showToast('Erro: ' + (e.message || 'falha inesperada'), 'error');
  });
  setTimeout(function () {
    if (typeof L === 'undefined' && typeof showToast === 'function') {
      showToast('O mapa não carregou (biblioteca Leaflet bloqueada). Verifique a internet.', 'error');
    }
  }, 2000);

  /* ---------- 3. SINCRONIZAÇÃO QUE NÃO ATROPELA A TELA ---------- */
  const num = v => Number(String(v == null ? '' : v).replace(',', '.')) || 0;

  function norm(r, idx) {
    return {
      id: Number(r.id) || idx + 1,
      produtor: String(r.produtor || '').trim(),
      municipio: String(r.municipio || '').trim(),
      cpf_cnpj: String(r.cpf_cnpj || '').trim(),
      fazenda: String(r.fazenda || '').trim(),
      area_ha: num(r.area_ha),
      passivo_prodes: num(r.passivo_prodes),
      empresa_regularizacao: String(r.empresa_regularizacao || 'Belterra').trim(),
      endereco: String(r.endereco || 'Não informado').trim(),
      telefone: String(r.telefone || '').trim(),
      termo_barter: String(r.termo_barter || 'Sim').trim(),
      status_crm: String(r.status_crm || 'Termo Assinado').trim(),
      lat: num(r.lat) || -3.65,
      lng: num(r.lng) || -53.2,
      observacoes: String(r.observacoes || '').trim(),
      updated_by: r.updated_by || '',
      updated_at: r.updated_at || ''
    };
  }

  // Mesmo formato para dados locais e remotos (antes, formatos diferentes
  // faziam a tela ser redesenhada e as edições serem sobrescritas).
  function fingerprint(list) {
    return JSON.stringify(
      list.map(norm).map(r => { delete r.updated_by; delete r.updated_at; return r; })
          .sort((a, b) => a.id - b.id)
    );
  }

  let lastPushAt = 0;

  function userIsBusy() {
    const modalOpen = ['modal-producer', 'modal-confirm', 'modal-cloud']
      .some(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
    const ae = document.activeElement;
    const editing = ae && (ae.tagName === 'SELECT' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
    const popupOpen = !!document.querySelector('.leaflet-popup');
    return modalOpen || editing || popupOpen;
  }

  ['pushRecordToCloud', 'deleteRecordFromCloud', 'pushAllToCloud'].forEach(function (name) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = async function () {
      lastPushAt = Date.now();
      const result = await original.apply(this, arguments);
      lastPushAt = Date.now();
      lastCloudFingerprint = fingerprint(producers);
      return result;
    };
  });

  window.pullFromCloud = async function (showFeedback) {
    if (!cloudApiUrl || isSyncing) return;
    if (document.hidden && !showFeedback) return;
    // Dá tempo para a própria edição chegar na planilha antes de buscar de volta
    if (!showFeedback && Date.now() - lastPushAt < 20000) return;

    isSyncing = true;
    updateCloudStatusUI('syncing', 'Sincronizando com a nuvem...');
    try {
      const response = await fetch(cloudApiUrl, { method: 'GET', redirect: 'follow' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const remote = await response.json();
      if (!Array.isArray(remote)) throw new Error('Resposta inválida da nuvem');

      if (remote.length === 0 && producers.length > 0) {
        isSyncing = false;
        await pushAllToCloud();
        return;
      }

      if (remote.length > 0) {
        const normalized = remote.map(norm);
        const fp = fingerprint(normalized);
        const changed = fp !== lastCloudFingerprint;

        // Só aplica mudança remota se a pessoa não estiver no meio de uma ação
        if (changed && (showFeedback || !userIsBusy())) {
          lastCloudFingerprint = fp;
          producers = normalized;
          saveProducersToStorage();
          populateMunicipioDropdowns();
          refreshAllViews();
        }

        const latest = normalized.filter(r => r.updated_by)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
        const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        updateCloudStatusUI('online', 'Online (' + t + ')' + (latest ? ' • Última edição: ' + latest.updated_by : ''));
        if (showFeedback) showToast('Dados sincronizados com sucesso entre Caio e Deice!', 'success');
      }
    } catch (err) {
      console.error('Erro na sincronização GET:', err);
      updateCloudStatusUI('error', 'Falha ao sincronizar — Verifique a URL da Nuvem');
      if (showFeedback) showToast('Não foi possível conectar à planilha. Verifique a URL do Apps Script.', 'error');
    } finally {
      isSyncing = false;
    }
  };

  /* ---------- 4. CLIQUE NO MARCADOR SEM FECHAR O POPUP ---------- */
  // Antes: setIcon() recriava todos os pinos durante o clique e o popup piscava/fechava.
  // Agora: só alterna uma classe CSS no pino.
  window.selectProducerOnMap = function (id, shouldOpenPopup) {
    if (shouldOpenPopup === undefined) shouldOpenPopup = true;
    const producer = producers.find(p => p.id === id);
    if (!producer) return;

    selectedProducerId = id;
    Object.keys(markersById).forEach(function (mid) {
      const icon = markersById[mid]._icon;
      if (icon && icon.firstElementChild) {
        icon.firstElementChild.classList.toggle('pin-pulse', Number(mid) === id);
      }
    });

    renderMapSidePanel(producer);

    const marker = markersById[id];
    if (shouldOpenPopup && marker && leafletMap) {
      leafletMap.setView(marker.getLatLng(), Math.max(leafletMap.getZoom(), 12), { animate: true });
      marker.openPopup();
    }
  };

  // Mantém o pino selecionado destacado quando o mapa é redesenhado
  const originalRenderMarkers = window.renderMapMarkers;
  window.renderMapMarkers = function () {
    originalRenderMarkers.apply(this, arguments);
    const marker = markersById[selectedProducerId];
    if (marker && marker._icon && marker._icon.firstElementChild) {
      marker._icon.firstElementChild.classList.add('pin-pulse');
    }
  };
})();
