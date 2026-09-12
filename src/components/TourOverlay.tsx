import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Check } from './icons';
import { useI18n } from '../lib/i18n';
import { TOUR_STEPS, markTourCompleted, type TourStep } from '../lib/tour';

/**
 * ONB-1 — TourOverlay.
 *
 * Spotlight-driven first-run tour. For each step:
 *  - Find the element matching step.selector (a [data-tour="..."] target).
 *  - Compute its bounding rect; draw a translucent overlay over the entire
 *    viewport EXCEPT that rect (use 4 absolutely-positioned divs so we
 *    don't cover the spotlight with a single overlay's box-shadow trick).
 *  - Render a popover next to the rect (top/bottom/left/right/auto).
 *  - "Next" advances to the next step; "Skip tour" completes immediately.
 *  - On last step, "Done" marks the tour as completed in localStorage.
 *
 * The tour auto-cancels if the target element isn't found for a step
 * (e.g. on a page where it isn't mounted) — we log a warning and skip
 * to the next step.
 */
export function TourOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const step: TourStep | undefined = TOUR_STEPS[stepIdx];

  // Re-locate the target element whenever the step changes.
  useEffect(() => {
    if (!step) return;
    let rafId: number | null = null;
    const findTarget = () => {
      const el = document.querySelector(step.selector);
      if (el) {
        // Use requestAnimationFrame for accurate layout measurement —
        // getBoundingClientRect on a freshly-mounted element (e.g. after
        // Suspense lazy-load) can return zeros if layout hasn't settled.
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const rect = el.getBoundingClientRect();
          // Skip zero-size rects (element hidden or not yet rendered).
          if (rect.width === 0 || rect.height === 0) {
            setTargetRect(null);
            setPopoverPos(null);
            return;
          }
          setTargetRect(rect);
          // Pick a popover position.
          const placement = step.placement ?? 'auto';
          const POPOVER_W = 360;
          const POPOVER_H = 200; // Slightly taller — some steps have long descriptions
          const GAP = 16; // Increased from 12 → 16 so popover clears the spotlight border
          let top: number;
          let left: number;
          if (placement === 'bottom') {
            top = rect.bottom + GAP;
            left = rect.left + rect.width / 2 - POPOVER_W / 2;
          } else if (placement === 'top') {
            top = rect.top - POPOVER_H - GAP;
            left = rect.left + rect.width / 2 - POPOVER_W / 2;
          } else if (placement === 'left') {
            top = rect.top + rect.height / 2 - POPOVER_H / 2;
            left = rect.left - POPOVER_W - GAP;
          } else if (placement === 'right') {
            top = rect.top + rect.height / 2 - POPOVER_H / 2;
            left = rect.right + GAP;
          } else {
            // 'auto' — pick the side with the most viewport space.
            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;
            const spaceRight = viewportW - rect.right;
            const spaceBottom = viewportH - rect.bottom;
            if (spaceRight >= POPOVER_W + GAP) {
              top = rect.top + rect.height / 2 - POPOVER_H / 2;
              left = rect.right + GAP;
            } else if (spaceBottom >= POPOVER_H + GAP) {
              top = rect.bottom + GAP;
              left = rect.left + rect.width / 2 - POPOVER_W / 2;
            } else if (rect.left >= POPOVER_W + GAP) {
              top = rect.top + rect.height / 2 - POPOVER_H / 2;
              left = rect.left - POPOVER_W - GAP;
            } else {
              top = rect.top - POPOVER_H - GAP;
              left = rect.left + rect.width / 2 - POPOVER_W / 2;
            }
          }
          // Clamp to viewport — but NEVER let the popover overlap the
          // target rect. If clamping would push it into the target, flip
          // to the opposite side.
          const clampedTop = Math.max(8, Math.min(top, window.innerHeight - POPOVER_H - 8));
          const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - POPOVER_W - 8));
          // Check if clamped position overlaps the target — if so, flip.
          const overlapsTarget =
            clampedTop < rect.bottom + GAP &&
            clampedTop + POPOVER_H > rect.top - GAP &&
            clampedLeft < rect.right + GAP &&
            clampedLeft + POPOVER_W > rect.left - GAP;
          if (overlapsTarget && placement === 'bottom') {
            // Flip to top instead.
            top = Math.max(8, rect.top - POPOVER_H - GAP);
            setPopoverPos({ top, left: clampedLeft });
          } else {
            setPopoverPos({ top: clampedTop, left: clampedLeft });
          }
        });
      } else {
        setTargetRect(null);
        setPopoverPos(null);
      }
    };
    findTarget();
    // Re-position on scroll/resize so the spotlight tracks the target.
    const onScrollOrResize = () => findTarget();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [step]);

  if (!step) return null;

  const handleNext = () => {
    if (stepIdx < TOUR_STEPS.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      markTourCompleted();
      onClose();
    }
  };
  const handleBack = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };
  const handleSkip = () => {
    markTourCompleted();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal={true} aria-label={t('tour.ariaLabel')}>
      {/* Four overlay rectangles forming the "spotlight cut-out". */}
      {targetRect ? (
        <>
          {/* Top strip */}
          <div className="fixed top-0 left-0 right-0 bg-black/60" style={{ height: targetRect.top }} />
          {/* Bottom strip */}
          <div className="fixed left-0 right-0 bottom-0 bg-black/60" style={{ top: targetRect.bottom }} />
          {/* Left strip */}
          <div className="fixed top-0 left-0 bottom-0 bg-black/60" style={{ width: targetRect.left }} />
          {/* Right strip */}
          <div className="fixed top-0 right-0 bottom-0 bg-black/60" style={{ left: targetRect.right }} />
          {/* Spotlight border */}
          <div
            className="fixed pointer-events-none border-2 border-accent rounded"
            style={{
              top: targetRect.top - 2,
              left: targetRect.left - 2,
              width: targetRect.width + 4,
              height: targetRect.height + 4,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
            }}
          />
        </>
      ) : (
        // Target not found — full overlay so the user can still skip /
        // advance. Bug fix: previously the popover was ONLY rendered when
        // popoverPos was set, which means if a tour step's target wasn't
        // mounted (e.g. user is on a page without the spotlighted
        // element), the user saw only the bg-black/60 dim overlay with
        // NO way to dismiss — the X-skip button was inside the popover
        // that never rendered. Now we center a popover with Next/Skip
        // so the user can recover.
        <div
          className="fixed panel p-4 shadow-2xl w-[360px] z-[101]"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="text-sm font-semibold text-text-primary">{t(step.titleKey)}</div>
            <button className="icon-btn !w-5 !h-5" onClick={handleSkip} aria-label={t('tour.skip')} title={t('tour.skip')}>
              <X size={12} />
            </button>
          </div>
          <div className="text-xs text-text-secondary leading-relaxed mb-4">
            {t(step.descKey)}
            <div className="mt-2 text-2xs text-text-tertiary italic">
              (Target not on this page — skipping to next step.)
            </div>
          </div>
          <div className="flex items-center justify-end gap-1">
            {stepIdx > 0 && (
              <button className="btn btn-secondary text-2xs !py-1 !px-2 flex items-center gap-1" onClick={handleBack}>
                <ChevronLeft size={10} />
                {t('tour.back')}
              </button>
            )}
            {stepIdx < TOUR_STEPS.length - 1 ? (
              <button className="btn btn-primary text-2xs !py-1 !px-2 flex items-center gap-1" onClick={handleNext}>
                {t('tour.next')}
                <ChevronRight size={10} />
              </button>
            ) : (
              <button className="btn btn-primary text-2xs !py-1 !px-2 flex items-center gap-1" onClick={handleNext}>
                <Check size={10} />
                {t('tour.done')}
              </button>
            )}
          </div>
        </div>
      )}

      {popoverPos && (
        <div
          className="fixed panel p-4 shadow-2xl w-[360px] z-[101]"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="text-sm font-semibold text-text-primary">{t(step.titleKey)}</div>
            <button className="icon-btn !w-5 !h-5" onClick={handleSkip} aria-label={t('tour.skip')} title={t('tour.skip')}>
              <X size={12} />
            </button>
          </div>
          <div className="text-xs text-text-secondary leading-relaxed mb-4">{t(step.descKey)}</div>
          <div className="flex items-center justify-between">
            <span className="text-2xs text-text-tertiary">
              {t('tour.stepIndicator', { current: stepIdx + 1, total: TOUR_STEPS.length })}
            </span>
            <div className="flex items-center gap-1">
              {stepIdx > 0 && (
                <button className="btn btn-secondary text-2xs !py-1 !px-2 flex items-center gap-1" onClick={handleBack}>
                  <ChevronLeft size={10} />
                  {t('tour.back')}
                </button>
              )}
              {stepIdx < TOUR_STEPS.length - 1 ? (
                <button className="btn btn-primary text-2xs !py-1 !px-2 flex items-center gap-1" onClick={handleNext}>
                  {t('tour.next')}
                  <ChevronRight size={10} />
                </button>
              ) : (
                <button className="btn btn-primary text-2xs !py-1 !px-2 flex items-center gap-1" onClick={handleNext}>
                  <Check size={10} />
                  {t('tour.done')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
