/**
 * The reports tab: every report the registry knows plus the thesis strip that
 * scores each registered conclusion. Moved out of AssetsPage unchanged when the
 * assets tab became the hub.
 */

import type { ReactNode } from 'react'
import type { AssetOverview } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from '../AssetsPage.module.css'

/** The ui.assets translate seat this package's components read. */
type Translate = TranslateNS<'ui.assets'>

/** The thesis strip: running score plus one line per thesis. */
function ThesisStrip({ theses, t }: { readonly theses: AssetOverview['theses']; readonly t: Translate }): ReactNode {
  const score = theses.score
  return (
    <section>
      <h3 className={css.sectionTitle}>{t('thesisSectionTitle')}</h3>
      <p className={css.scoreLine}>
        {score.hit_rate === null
          ? t('thesisScoreEmpty')
          : t('thesisScore', {
            hits: String(score.hits),
            'hits+misses': String(score.hits + score.misses),
            rate: `${(score.hit_rate * 100).toFixed(1)}%`,
          })}
        {` · ${t('thesisCount', { count: String(theses.items.length) })}`}
      </p>
      {theses.items.length === 0
        ? <p className={css.cardDesc}>{t('thesisEmpty')}</p>
        : (
          <ul className={css.grid}>
            {theses.items.map(thesis => (
              <li key={thesis.id} className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.chip} data-status={thesis.status} data-overdue={String(thesis.overdue)}>
                    {thesis.status === 'hit'
                      ? t('thesisStatusHit')
                      : thesis.status === 'miss'
                        ? t('thesisStatusMiss')
                        : thesis.overdue ? t('thesisOverdue') : t('thesisStatusOpen')}
                  </span>
                  <span className={css.cardName} title={thesis.id}>{thesis.id}</span>
                </div>
                <p className={css.cardDesc}>{thesis.conclusion}</p>
                <dl className={css.cardFacts}>
                  <div>
                    <dt>{`${t('thesisDue')}: `}</dt>
                    <dd>{thesis.due_date}</dd>
                  </div>
                  <div>
                    <dt>{'-> '}</dt>
                    <dd>{thesis.report}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/** Render the reports tab over one overview snapshot. */
export function ReportsTab({ overview, t }: {
  readonly overview: AssetOverview
  readonly t: Translate
}): ReactNode {
  return (
    <>
      {overview.reports.length === 0
        ? <p className={css.status}>{t('emptyReports')}</p>
        : (
          <ul className={css.grid}>
            {overview.reports.map(report => (
              <li key={`${report.workspaceId}/${report.file}`} className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardName} title={report.file}>{report.title}</span>
                </div>
                <dl className={css.cardFacts}>
                  <div>
                    <dt>{`${t('reportWorkspace')}: `}</dt>
                    <dd>{report.workspaceTitle}</dd>
                  </div>
                  <div>
                    <dt>{`${t('reportModified')}: `}</dt>
                    <dd>{report.modifiedAt.slice(0, 16).replace('T', ' ')}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      <ThesisStrip theses={overview.theses} t={t} />
    </>
  )
}
