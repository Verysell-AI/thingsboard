import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ExternalLink, Plus } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { useAdminTenants } from '~/lib/admin';
import { formatDate } from '~/lib/format';

export default function AdminHomeRoute() {
  const { t, i18n } = useTranslation();
  const tenants = useAdminTenants();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('admin.tenants.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.tenants.help')}</p>
        </div>
        <Button asChild className="ms-auto">
          <Link to="/admin/tenants/new">
            <Plus className="size-4" />
            {t('admin.tenants.new')}
          </Link>
        </Button>
      </div>

      {tenants.isPending ? (
        <p className="text-sm text-muted-foreground">{t('app.loading')}</p>
      ) : tenants.isError ? (
        <p className="text-sm text-destructive">{t('app.error')}</p>
      ) : tenants.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.tenants.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.tenants.columns.name')}</TableHead>
              <TableHead>{t('admin.tenants.columns.key')}</TableHead>
              <TableHead>{t('admin.tenants.columns.hostname')}</TableHead>
              <TableHead>{t('admin.tenants.columns.users')}</TableHead>
              <TableHead>{t('admin.tenants.columns.created')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.data.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-4 shrink-0 rounded-full border"
                      style={{ background: tenant.primaryColor }}
                      aria-hidden
                    />
                    <Link
                      to={`/admin/tenants/${tenant.key}`}
                      className="font-medium hover:underline"
                    >
                      {tenant.name}
                    </Link>
                    {tenant.demoMode && <Badge variant="accent">{t('admin.tenants.demo')}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{tenant.key}</TableCell>
                <TableCell className="text-muted-foreground">{tenant.hostname}</TableCell>
                <TableCell>{tenant.userCount}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(tenant.createdAt, i18n.language)}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={tenant.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      {t('admin.tenants.open')}
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
