'use client';

import type { TimelineStep } from '@xb/contracts';
import { formatDateTime } from '../lib/api';

/**
 * The customer-facing tracking timeline.
 *
 * Eight steps, always the same eight, regardless of how many internal states the order has
 * passed through or which carrier is handling which leg. A customer should never have to
 * learn our vocabulary to find out where their parcel is.
 */
export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li
          key={step.key}
          className={`timeline-item ${step.status.toLowerCase()}`}
          aria-current={step.status === 'CURRENT' ? 'step' : undefined}
        >
          <span className="timeline-dot" aria-hidden="true">
            {step.status === 'DONE' ? '✓' : step.status === 'CURRENT' ? '●' : ''}
          </span>

          <div>
            <div className="timeline-label">{step.label.fa}</div>
            {step.occurredAt && (
              <div className="timeline-time">{formatDateTime(step.occurredAt, 'fa')}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
