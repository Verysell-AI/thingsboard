import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { EmployeesResponseSchema, type MeResponse } from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';

const EMPLOYEE_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);

export default function EmployeesRoute() {
  const { t } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees', EmployeesResponseSchema),
    staleTime: 60_000,
  });
  const items = employees.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="employees-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('employees.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('employees.count', { count: items.length })}
          </p>
        </div>
        {EMPLOYEE_ROLES.has(me.user.role) && (
          <Button asChild>
            <Link to="/employees/new">
              <UserPlus aria-hidden /> {t('employees.new')}
            </Link>
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('employees.columns.code')}</TableHead>
            <TableHead>{t('employees.columns.name')}</TableHead>
            <TableHead>{t('employees.columns.department')}</TableHead>
            <TableHead>{t('employees.columns.desk')}</TableHead>
            {me.tenant.demoMode && <TableHead>{t('employees.columns.persona')}</TableHead>}
            <TableHead>{t('employees.columns.laptop')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.isPending && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                {t('app.loading')}
              </TableCell>
            </TableRow>
          )}
          {items.length === 0 && !employees.isPending && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                {t('employees.empty')}
              </TableCell>
            </TableRow>
          )}
          {items.map((e) => (
            <TableRow key={e.id} data-employee={e.code}>
              <TableCell className="font-mono text-xs" dir="ltr">
                {e.code}
              </TableCell>
              <TableCell className="font-medium">
                {e.name}
                <span className="block text-xs text-muted-foreground" dir="ltr">
                  {e.email}
                </span>
              </TableCell>
              <TableCell>
                {t(`departments.${e.department}`, { defaultValue: e.department })}
              </TableCell>
              <TableCell className="text-xs">
                {e.deskRoom ? `${e.deskRoom.name}` : '—'}
                {e.deskCode ? ` · ${e.deskCode}` : ''}
              </TableCell>
              {me.tenant.demoMode && (
                <TableCell className="text-xs">
                  {e.persona ? t(`personas.${e.persona}`, { defaultValue: e.persona }) : '—'}
                </TableCell>
              )}
              <TableCell>
                {e.laptop ? (
                  <Link
                    to={assetDrawerLink(e.laptop.assetId)}
                    className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                    dir="ltr"
                  >
                    {e.laptop.code}
                  </Link>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
