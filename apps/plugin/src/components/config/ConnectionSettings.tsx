import React, { useEffect, useMemo, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import type { AppPluginMeta, PluginConfigPageProps, PluginMeta, SelectableValue } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, Select } from '@grafana/ui';

type SigilJSONData = {
  sigilApiUrl?: string;
  tenantId?: string;
  prometheusDatasourceUID?: string;
  tempoDatasourceUID?: string;
};

type GrafanaDatasource = {
  uid?: string;
  name?: string;
  type?: string;
};

type TenantSettingsResponse = {
  datasources?: {
    prometheusDatasourceUID?: string;
    tempoDatasourceUID?: string;
  };
};

export interface ConnectionSettingsProps extends PluginConfigPageProps<AppPluginMeta<SigilJSONData>> {}

export default function ConnectionSettings({ plugin }: ConnectionSettingsProps) {
  const [sigilApiUrl, setSigilApiUrl] = useState(plugin.meta.jsonData?.sigilApiUrl ?? 'http://sigil:8080');
  const [tenantId, setTenantId] = useState(plugin.meta.jsonData?.tenantId ?? 'fake');
  const [prometheusDatasourceUID, setPrometheusDatasourceUID] = useState(
    plugin.meta.jsonData?.prometheusDatasourceUID ?? ''
  );
  const [tempoDatasourceUID, setTempoDatasourceUID] = useState(plugin.meta.jsonData?.tempoDatasourceUID ?? '');
  const [datasources, setDatasources] = useState<GrafanaDatasource[]>([]);

  useEffect(() => {
    const loadSettings = async () => {
      const [datasourceResponse, tenantSettingsResponse] = await Promise.all([
        lastValueFrom(
          getBackendSrv().fetch<GrafanaDatasource[]>({
            url: '/api/datasources',
            method: 'GET',
          })
        ),
        lastValueFrom(
          getBackendSrv().fetch<TenantSettingsResponse>({
            url: `/api/plugins/${plugin.meta.id}/resources/query/settings`,
            method: 'GET',
          })
        ).catch(() => ({ data: {} as TenantSettingsResponse })),
      ]);

      setDatasources(Array.isArray(datasourceResponse.data) ? datasourceResponse.data : []);
      const settings = tenantSettingsResponse.data?.datasources;
      if (settings) {
        setPrometheusDatasourceUID(settings.prometheusDatasourceUID ?? '');
        setTempoDatasourceUID(settings.tempoDatasourceUID ?? '');
      }
    };

    void loadSettings();
  }, [plugin.meta.id]);

  const prometheusOptions = useMemo(() => buildDatasourceOptions(datasources, 'prometheus'), [datasources]);
  const tempoOptions = useMemo(() => buildDatasourceOptions(datasources, 'tempo'), [datasources]);
  const prometheusValue = useMemo(
    () => prometheusOptions.find((option) => option.value === prometheusDatasourceUID) ?? null,
    [prometheusOptions, prometheusDatasourceUID]
  );
  const tempoValue = useMemo(
    () => tempoOptions.find((option) => option.value === tempoDatasourceUID) ?? null,
    [tempoOptions, tempoDatasourceUID]
  );

  const onSave = async () => {
    await updatePlugin(plugin.meta.id, {
      enabled: plugin.meta.enabled,
      pinned: plugin.meta.pinned,
      jsonData: {
        sigilApiUrl,
        tenantId,
        // Kept as fallback while tenant settings migration is incremental.
        prometheusDatasourceUID: prometheusDatasourceUID.trim(),
        tempoDatasourceUID: tempoDatasourceUID.trim(),
      },
    });
    await updateTenantDatasourceSettings(plugin.meta.id, {
      prometheusDatasourceUID: prometheusDatasourceUID.trim(),
      tempoDatasourceUID: tempoDatasourceUID.trim(),
    });
    window.location.reload();
  };

  return (
    <FieldSet label="Sigil Service">
      <Field label="Sigil API URL" description="Base URL for the Sigil query and records APIs.">
        <Input width={60} value={sigilApiUrl} onChange={(e) => setSigilApiUrl(e.currentTarget.value)} />
      </Field>
      <Field
        label="Tenant ID Fallback"
        description="Used when no X-Scope-OrgID header is provided. Defaults to fake for local development."
      >
        <Input width={30} value={tenantId} onChange={(e) => setTenantId(e.currentTarget.value)} />
      </Field>
      <Field
        label="Prometheus Datasource"
        description="Datasource UID used for Prometheus proxy queries via Grafana."
      >
        <Select
          width={40}
          options={prometheusOptions}
          value={prometheusValue}
          isClearable
          onChange={(option) => setPrometheusDatasourceUID(option?.value ?? '')}
        />
      </Field>
      <Field label="Tempo Datasource" description="Datasource UID used for Tempo proxy queries via Grafana.">
        <Select
          width={40}
          options={tempoOptions}
          value={tempoValue}
          isClearable
          onChange={(option) => setTempoDatasourceUID(option?.value ?? '')}
        />
      </Field>
      <Button onClick={onSave}>Save settings</Button>
    </FieldSet>
  );
}

function buildDatasourceOptions(datasources: GrafanaDatasource[], datasourceType: string): Array<SelectableValue<string>> {
  return datasources
    .filter((datasource) => datasource.type === datasourceType && datasource.uid && datasource.name)
    .map((datasource) => ({
      label: datasource.name,
      value: datasource.uid!,
      description: datasource.uid!,
    }))
    .sort((left, right) => (left.label ?? '').localeCompare(right.label ?? ''));
}

async function updatePlugin(pluginId: string, data: Partial<PluginMeta<SigilJSONData>>) {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });
  return lastValueFrom(response);
}

async function updateTenantDatasourceSettings(
  pluginId: string,
  datasources: Pick<SigilJSONData, 'prometheusDatasourceUID' | 'tempoDatasourceUID'>
) {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/resources/query/settings/datasources`,
    method: 'PUT',
    data: { datasources },
  });
  return lastValueFrom(response);
}
