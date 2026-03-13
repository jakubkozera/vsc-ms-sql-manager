import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from 'react';
import './HoverPopup.css';

export type HoverPopupPlacement = 'top' | 'bottom' | 'left' | 'right';

interface HoverPopupProps {
  /** Content shown inside the popup */
  content: ReactNode;
  /** The trigger element(s) that the popup attaches to */
  children: ReactNode;
  /** Preferred placement relative to the trigger */
  placement?: HoverPopupPlacement;
  /** Delay in ms before the popup appears */
  enterDelay?: number;
  /** Delay in ms before the popup disappears */
  leaveDelay?: number;
  /** Extra class name for the popup container */
  className?: string;
  /** Whether to use error styling (red border) */
  variant?: 'default' | 'error';
  /** Max width of the popup */
  maxWidth?: number;
}

export function HoverPopup({
  content,
  children,
  placement = 'top',
  enterDelay = 150,
  leaveDelay = 100,
  className,
  variant = 'default',
  maxWidth = 320,
}: HoverPopupProps) {
  const [visible, setVisible] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [actualPlacement, setActualPlacement] = useState(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
  }, []);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;
    let resolved = placement;

    // Calculate position for each placement, flipping if off-screen
    switch (placement) {
      case 'top': {
        top = triggerRect.top - popupRect.height - gap;
        left = triggerRect.left + triggerRect.width / 2 - popupRect.width / 2;
        if (top < 4) { resolved = 'bottom'; top = triggerRect.bottom + gap; }
        break;
      }
      case 'bottom': {
        top = triggerRect.bottom + gap;
        left = triggerRect.left + triggerRect.width / 2 - popupRect.width / 2;
        if (top + popupRect.height > window.innerHeight - 4) { resolved = 'top'; top = triggerRect.top - popupRect.height - gap; }
        break;
      }
      case 'left': {
        top = triggerRect.top + triggerRect.height / 2 - popupRect.height / 2;
        left = triggerRect.left - popupRect.width - gap;
        if (left < 4) { resolved = 'right'; left = triggerRect.right + gap; }
        break;
      }
      case 'right': {
        top = triggerRect.top + triggerRect.height / 2 - popupRect.height / 2;
        left = triggerRect.right + gap;
        if (left + popupRect.width > window.innerWidth - 4) { resolved = 'left'; left = triggerRect.left - popupRect.width - gap; }
        break;
      }
    }

    // Clamp to viewport
    left = Math.max(4, Math.min(left, window.innerWidth - popupRect.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - popupRect.height - 4));

    setPosition({ top, left });
    setActualPlacement(resolved);
  }, [placement]);

  const handleMouseEnter = useCallback(() => {
    clearTimers();
    enterTimerRef.current = setTimeout(() => {
      setVisible(true);
    }, enterDelay);
  }, [enterDelay, clearTimers]);

  const handleMouseLeave = useCallback(() => {
    clearTimers();
    leaveTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, leaveDelay);
  }, [leaveDelay, clearTimers]);

  // Recompute position when popup becomes visible
  useEffect(() => {
    if (visible) {
      setPositioned(false);
      // Use rAF to wait for the popup to render before measuring
      const id = requestAnimationFrame(() => {
        computePosition();
        setPositioned(true);
      });
      return () => cancelAnimationFrame(id);
    } else {
      setPositioned(false);
    }
  }, [visible, computePosition]);

  // Clean up timers on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const popupStyle: CSSProperties = {
    top: position.top,
    left: position.left,
    maxWidth,
    opacity: positioned ? 1 : 0,
  };

  return (
    <span
      ref={triggerRef}
      className="hover-popup-trigger"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && (
        <div
          ref={popupRef}
          className={`hover-popup hover-popup-${actualPlacement} hover-popup-${variant}${className ? ` ${className}` : ''}`}
          style={popupStyle}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          role="tooltip"
        >
          <div className="hover-popup-content">{content}</div>
          <span className={`hover-popup-arrow hover-popup-arrow-${actualPlacement}`} />
        </div>
      )}
    </span>
  );
}
