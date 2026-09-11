import { Construction, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '~/components/ui/card';

/** Empty state for routes that arrive in a later phase; says what the page will hold. */
export function PlaceholderPage({
  titleKey,
  descriptionKey,
  icon: Icon = Construction,
}: {
  titleKey: string;
  descriptionKey?: string;
  icon?: LucideIcon;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t(titleKey)}</h1>
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-6" aria-hidden />
          </span>
          <p className="font-medium">{t('app.comingLater')}</p>
          {descriptionKey && (
            <p className="max-w-md text-sm text-muted-foreground">{t(descriptionKey)}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
