import React from 'react';
import { Icon, IconName } from './Icon';

/**
 * Shared layout for every non-report state (loading, forwarding, rejected,
 * failed, stale, unavailable): a toned mark, a headline, a short description,
 * optional notices, a facts list, and the actions for that state.
 */
export type ScreenTone = 'neutral' | 'danger' | 'warning' | 'success' | 'info';

export interface Fact {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

interface StatusScreenProps {
  tone: ScreenTone;
  icon: IconName;
  title: string;
  description?: React.ReactNode;
  /** Rendered between the description and the facts (callouts, skeletons). */
  notice?: React.ReactNode;
  facts?: Fact[];
  /** Rendered after the facts (acknowledgements, actions). */
  children?: React.ReactNode;
  footnote?: React.ReactNode;
  /** Draws an indeterminate ring around the mark while waiting on something external. */
  busy?: boolean;
}

export const StatusScreen: React.FC<StatusScreenProps> = ({
  tone,
  icon,
  title,
  description,
  notice,
  facts,
  children,
  footnote,
  busy,
}) => (
  <section className="screen enter" data-tone={tone} aria-busy={busy ? 'true' : undefined}>
    <span className={busy ? 'screen-mark screen-mark--busy' : 'screen-mark'}>
      <Icon name={icon} size={20} />
    </span>
    <h2 className="screen-title">{title}</h2>
    {description && <p className="screen-desc">{description}</p>}
    {notice}
    {facts && facts.length > 0 && (
      <dl className="facts">
        {facts.map((fact) => (
          <div className="fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd className={fact.mono ? 'mono' : undefined}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    )}
    {children}
    {footnote && <p className="footnote footnote--left">{footnote}</p>}
  </section>
);
