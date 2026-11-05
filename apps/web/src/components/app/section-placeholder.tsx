'use client';

import { FileChartColumn, Images, Settings, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState, PageHeader } from './page-header';

const ICONS: Record<Section, LucideIcon> = {
  accounts: Users,
  content: Images,
  reports: FileChartColumn,
  settings: Settings,
};

type Section = 'accounts' | 'content' | 'reports' | 'settings';

/** Section page that has no functionality yet: title + explanation of what will be here. */
export function SectionPlaceholder({ section }: { section: Section }) {
  const t = useTranslations('Sections');
  const Icon = ICONS[section];

  return (
    <>
      <PageHeader title={t(`${section}.title`)} subtitle={t(`${section}.subtitle`)} />
      <EmptyState
        icon={<Icon size={24} strokeWidth={1.75} aria-hidden="true" />}
        title={t('soonTitle')}
        text={t(`${section}.text`)}
      />
    </>
  );
}
