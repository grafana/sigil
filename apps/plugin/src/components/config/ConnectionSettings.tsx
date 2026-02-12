import React, { useState } from 'react';
import { lastValueFrom } from 'rxjs';
import type { AppPluginMeta, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input } from '@grafana/ui';

type SigilJSONData = {
  sigilApiUrl?: string;
};

export interface ConnectionSettingsProps extends PluginConfigPageProps<AppPluginMeta<SigilJSONData>> {}

export default function ConnectionSettings({ plugin }: ConnectionSettingsProps) {
  const [sigilApiUrl, setSigilApiUrl] = useState(plugin.meta.jsonData?.sigilApiUrl ?? 'http://sigil:8080');

  const onSave = async () => {
    await updatePlugin(plugin.meta.id, {
      enabled: plugin.meta.enabled,
      pinned: plugin.meta.pinned,
      jsonData: { sigilApiUrl },
    });
    window.location.reload();
  };

  return (
    <FieldSet label="Sigil Service">
      <Field label="Sigil API URL" description="Base URL for the Sigil query and records APIs.">
        <Input width={60} value={sigilApiUrl} onChange={(e) => setSigilApiUrl(e.currentTarget.value)} />
      </Field>
      <Button onClick={onSave}>Save settings</Button>
    </FieldSet>
  );
}

async function updatePlugin(pluginId: string, data: Partial<PluginMeta<SigilJSONData>>) {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });
  return lastValueFrom(response);
}
