'use strict';

// ===== Интеграция Telegram Mini App =====
// Вызывается из main() после DOMContentLoaded: к этому моменту defer-скрипт
// telegram-web-app.js уже выполнен (или не загрузился — тогда мы не в Telegram).

let TG = null;      // Telegram.WebApp или null
let IS_TMA = false; // запущены ли мы как Mini App

function initTelegram() {
  TG = (window.Telegram && window.Telegram.WebApp) || null;
  IS_TMA = !!(TG && TG.initData);
  if (!IS_TMA) return;

  TG.ready();
  TG.expand();
  try { TG.setHeaderColor('#0d0d14'); TG.setBackgroundColor('#0d0d14'); } catch (e) {}

  // вертикальные свайпы сворачивают мини-апп — с джойстиком это недопустимо
  if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
  // случайное закрытие = потеря несохранённого боя
  if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();

  // фулскрин на телефонах (Bot API 8.0+); на десктопе остаёмся в окне
  const mobilePlatform = TG.platform === 'ios' || TG.platform === 'android';
  if (mobilePlatform && TG.requestFullscreen && !TG.isFullscreen) {
    try { TG.requestFullscreen(); } catch (e) {}
  }

  // отступы: системная safe area + шапка Telegram (крестик/меню) → CSS-переменные
  const applyInsets = () => {
    const s = TG.safeAreaInset || {};
    const c = TG.contentSafeAreaInset || {};
    const st = document.documentElement.style;
    st.setProperty('--tg-top', ((s.top || 0) + (c.top || 0)) + 'px');
    st.setProperty('--tg-bottom', ((s.bottom || 0) + (c.bottom || 0)) + 'px');
    st.setProperty('--tg-left', ((s.left || 0) + (c.left || 0)) + 'px');
    st.setProperty('--tg-right', ((s.right || 0) + (c.right || 0)) + 'px');
    if (typeof resizeCanvas === 'function') resizeCanvas();
  };
  applyInsets();
  TG.onEvent('safeAreaChanged', applyInsets);
  TG.onEvent('contentSafeAreaChanged', applyInsets);
  TG.onEvent('fullscreenChanged', applyInsets);
  TG.onEvent('viewportChanged', applyInsets);
}
