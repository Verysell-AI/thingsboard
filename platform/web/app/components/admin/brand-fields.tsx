import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import type { BrandAsset, BrandInput } from '@platform/shared/dto';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { BRAND_ACCEPT, brandAssetPreview, readBrandFile } from '~/lib/admin';

export interface BrandDraft {
  shortName: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  loginTagline: string;
  logo: BrandAsset | null;
  favicon: BrandAsset | null;
}

export const DEFAULT_BRAND_DRAFT: BrandDraft = {
  shortName: '',
  primaryColor: '#2563EB',
  accentColor: '#F59E0B',
  fontFamily: 'Inter, system-ui, sans-serif',
  loginTagline: '',
  logo: null,
  favicon: null,
};

/** Only the fields the operator filled in are sent; the rest keep their current value. */
export function brandDraftToInput(draft: BrandDraft, name?: string): BrandInput | undefined {
  const input: BrandInput = {
    ...(name ? { name } : {}),
    ...(draft.shortName ? { shortName: draft.shortName } : {}),
    ...(draft.primaryColor ? { primaryColor: draft.primaryColor } : {}),
    ...(draft.accentColor ? { accentColor: draft.accentColor } : {}),
    ...(draft.fontFamily ? { fontFamily: draft.fontFamily } : {}),
    loginTagline: draft.loginTagline || null,
    ...(draft.logo ? { logo: draft.logo } : {}),
    ...(draft.favicon ? { favicon: draft.favicon } : {}),
  };
  return Object.keys(input).length ? input : undefined;
}

function AssetPicker({
  id,
  label,
  asset,
  currentUrl,
  onPick,
}: {
  id: string;
  label: string;
  asset: BrandAsset | null;
  currentUrl?: string | null;
  onPick: (asset: BrandAsset | null) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const preview = asset ? brandAssetPreview(asset) : (currentUrl ?? null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      onPick(await readBrandFile(file));
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'too-large'
          ? t('admin.brand.tooLarge')
          : t('admin.brand.unsupported'),
      );
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-28 items-center justify-center rounded-md border bg-muted/40 p-1">
          {preview ? (
            <img src={preview} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <Upload className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            id={id}
            type="file"
            accept={BRAND_ACCEPT}
            className="cursor-pointer"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <span className="text-xs text-muted-foreground">{t('admin.brand.formats')}</span>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Colours, typography and images shared by the create and edit forms. */
export function BrandFields({
  value,
  onChange,
  logoUrl,
  faviconUrl,
}: {
  value: BrandDraft;
  onChange: (next: BrandDraft) => void;
  logoUrl?: string | null;
  faviconUrl?: string | null;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof BrandDraft>(field: K, next: BrandDraft[K]) =>
    onChange({ ...value, [field]: next });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="shortName">{t('admin.brand.shortName')}</Label>
        <Input
          id="shortName"
          value={value.shortName}
          placeholder={t('admin.brand.shortNameHint')}
          onChange={(e) => set('shortName', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fontFamily">{t('admin.brand.font')}</Label>
        <Input
          id="fontFamily"
          value={value.fontFamily}
          onChange={(e) => set('fontFamily', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="primaryColor">{t('admin.brand.primary')}</Label>
        <div className="flex items-center gap-2">
          <input
            id="primaryColor"
            type="color"
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent"
            value={value.primaryColor}
            onChange={(e) => set('primaryColor', e.target.value.toUpperCase())}
          />
          <Input
            aria-label={t('admin.brand.primary')}
            value={value.primaryColor}
            onChange={(e) => set('primaryColor', e.target.value.toUpperCase())}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="accentColor">{t('admin.brand.accent')}</Label>
        <div className="flex items-center gap-2">
          <input
            id="accentColor"
            type="color"
            className="h-9 w-12 cursor-pointer rounded-md border bg-transparent"
            value={value.accentColor}
            onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
          />
          <Input
            aria-label={t('admin.brand.accent')}
            value={value.accentColor}
            onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="loginTagline">{t('admin.brand.tagline')}</Label>
        <Input
          id="loginTagline"
          value={value.loginTagline}
          onChange={(e) => set('loginTagline', e.target.value)}
        />
      </div>
      <AssetPicker
        id="logo"
        label={t('admin.brand.logo')}
        asset={value.logo}
        currentUrl={logoUrl}
        onPick={(a) => set('logo', a)}
      />
      <AssetPicker
        id="favicon"
        label={t('admin.brand.favicon')}
        asset={value.favicon}
        currentUrl={faviconUrl}
        onPick={(a) => set('favicon', a)}
      />
    </div>
  );
}
