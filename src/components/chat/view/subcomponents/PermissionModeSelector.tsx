import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { permissionModes, type PermissionModeId } from '../../constants/permissionModes';

type PermissionModeSelectorProps = {
  selectedMode: PermissionModeId;
  onModeChange: (modeId: PermissionModeId) => void;
  className?: string;
};

function PermissionModeSelector({ selectedMode, onModeChange, className = '' }: PermissionModeSelectorProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);

  const closeDropdown = useCallback(() => setIsOpen(false), []);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown || typeof window === 'undefined') {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = window.innerWidth < 640 ? 12 : 16;
    const spacing = 8;
    const width = Math.min(window.innerWidth - viewportPadding * 2, window.innerWidth < 640 ? 320 : 288);
    let left = triggerRect.left + triggerRect.width / 2 - width / 2;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - width - viewportPadding));

    const measuredHeight = dropdown.offsetHeight || 0;
    const spaceBelow = window.innerHeight - triggerRect.bottom - spacing - viewportPadding;
    const spaceAbove = triggerRect.top - spacing - viewportPadding;
    const openBelow = spaceBelow >= Math.min(measuredHeight || 320, 320) || spaceBelow >= spaceAbove;
    const availableHeight = Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(180, openBelow ? spaceBelow : spaceAbove),
    );
    const panelHeight = Math.min(measuredHeight || availableHeight, availableHeight);
    const top = openBelow
      ? Math.min(triggerRect.bottom + spacing, window.innerHeight - viewportPadding - panelHeight)
      : Math.max(viewportPadding, triggerRect.top - spacing - panelHeight);

    setDropdownStyle({ position: 'fixed', top, left, width, maxHeight: availableHeight, zIndex: 80 });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setDropdownStyle(null);
      return;
    }
    const rafId = window.requestAnimationFrame(updateDropdownPosition);
    const handleViewportChange = () => updateDropdownPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      closeDropdown();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeDropdown]);

  const currentMode = permissionModes.find((mode) => mode.id === selectedMode) || permissionModes[0];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={`rounded-lg border p-2 text-xs font-medium transition-all duration-200 sm:px-2.5 sm:py-1 ${currentMode.pill}`}
        title={t('input.clickToChangeMode')}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-1.5">
          <div className={`h-2.5 w-2.5 rounded-full sm:h-1.5 sm:w-1.5 ${currentMode.dot}`} />
          <span className="hidden whitespace-nowrap sm:inline">
            {t(`codex.modes.${currentMode.id}`)}
          </span>
        </div>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
          role="dialog"
          aria-modal="false"
        >
          <div className="flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('codex.permissionMode')}
            </h3>
            <button
              type="button"
              onClick={closeDropdown}
              className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto py-1">
            {permissionModes.map((mode) => {
              const ModeIcon = mode.icon;
              const isSelected = mode.id === selectedMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    onModeChange(mode.id);
                    closeDropdown();
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${mode.iconColor}`}>
                      <ModeIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                          {t(`codex.modes.${mode.id}`)}
                        </span>
                        {isSelected && (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                            {t('thinkingMode.selector.active')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {t(`codex.descriptions.${mode.id}`)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default PermissionModeSelector;
