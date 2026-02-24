import { onBeforeUnmount, watch } from 'vue';

function getFocusableElements(container) {
  if (!container) return [];
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ];
  const nodes = Array.from(container.querySelectorAll(selectors.join(',')));
  return nodes.filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  });
}

/**
 * Minimal focus trap for dialogs/drawers.
 *
 * - Traps Tab/Shift+Tab within `containerRef`.
 * - Optionally focuses `initialFocusRef` on activation (else first focusable).
 * - Restores focus to the previously-active element on deactivation.
 */
export function useFocusTrap({ active, containerRef, initialFocusRef }) {
  let previousActiveElement = null;

  function onKeydown(event) {
    if (event.key !== 'Tab') return;

    const container = containerRef?.value;
    if (!container) return;

    const focusables = getFocusableElements(container);
    if (!focusables.length) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const current = document.activeElement;
    const isShift = !!event.shiftKey;

    if (isShift) {
      if (current === first || !container.contains(current)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function focusInitialElement() {
    const container = containerRef?.value;
    if (!container) return;

    const preferred = initialFocusRef?.value;
    if (preferred && typeof preferred.focus === 'function') {
      preferred.focus();
      return;
    }

    const focusables = getFocusableElements(container);
    if (focusables[0]) focusables[0].focus();
    else container.focus?.();
  }

  watch(
    active,
    async (isActive) => {
      if (!import.meta.client) return;
      if (isActive) {
        previousActiveElement = document.activeElement;
        window.addEventListener('keydown', onKeydown);
        requestAnimationFrame(() => focusInitialElement());
        return;
      }

      window.removeEventListener('keydown', onKeydown);
      const restore = previousActiveElement;
      previousActiveElement = null;
      if (restore && typeof restore.focus === 'function') {
        requestAnimationFrame(() => restore.focus());
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    if (!import.meta.client) return;
    window.removeEventListener('keydown', onKeydown);
  });
}
