import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import type { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta, SelectableValue } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import {
  Alert,
  Button,
  ConfirmModal,
  Field,
  FieldSet,
  IconButton,
  Input,
  Select,
  useStyles2,
} from '@grafana/ui';
import { css } from '@emotion/css';

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

// --- Connection profiles (localStorage) ---

interface ConnectionProfile {
  id: string;
  name: string;
  sigilApiUrl: string;
  tenantId: string;
  prometheusDatasourceUID: string;
  tempoDatasourceUID: string;
  /** Plain-text token stored in localStorage for convenience. Acceptable for local dev tooling. */
  authToken: string;
}

const PROFILES_STORAGE_KEY = 'sigil-connection-profiles';
const ACTIVE_PROFILE_KEY = 'sigil-active-profile';

function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConnectionProfile[]) : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

function loadActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

function saveActiveProfileId(id: string | null) {
  if (id === null) {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } else {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Component ---

export interface ConnectionSettingsProps extends PluginConfigPageProps<AppPluginMeta<SigilJSONData>> { }

export default function ConnectionSettings({ plugin }: ConnectionSettingsProps) {
  const styles = useStyles2(getStyles);

  const [sigilApiUrl, setSigilApiUrl] = useState(plugin.meta.jsonData?.sigilApiUrl ?? 'http://sigil:8080');
  const [tenantId, setTenantId] = useState(plugin.meta.jsonData?.tenantId ?? 'fake');
  const [apiAuthToken, setApiAuthToken] = useState('');
  const [prometheusDatasourceUID, setPrometheusDatasourceUID] = useState(
    plugin.meta.jsonData?.prometheusDatasourceUID ?? ''
  );
  const [tempoDatasourceUID, setTempoDatasourceUID] = useState(plugin.meta.jsonData?.tempoDatasourceUID ?? '');
  const [datasources, setDatasources] = useState<GrafanaDatasource[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Profiles state
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(loadProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(loadActiveProfileId);
  const [newProfileName, setNewProfileName] = useState('');
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<ConnectionProfile | null>(null);

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

  const applyProfile = useCallback((profile: ConnectionProfile) => {
    setSigilApiUrl(profile.sigilApiUrl);
    setTenantId(profile.tenantId);
    setPrometheusDatasourceUID(profile.prometheusDatasourceUID);
    setTempoDatasourceUID(profile.tempoDatasourceUID);
    setApiAuthToken(profile.authToken);
  }, []);

  const handleSwitchProfile = useCallback(
    (profileId: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) {
        return;
      }
      setActiveProfileId(profileId);
      saveActiveProfileId(profileId);
      applyProfile(profile);
    },
    [profiles, applyProfile]
  );

  const handleCreateProfile = useCallback(() => {
    const name = newProfileName.trim();
    if (!name) {
      return;
    }
    const profile: ConnectionProfile = {
      id: generateId(),
      name,
      sigilApiUrl,
      tenantId,
      prometheusDatasourceUID,
      tempoDatasourceUID,
      authToken: apiAuthToken.trim(),
    };
    const updated = [...profiles, profile];
    setProfiles(updated);
    saveProfiles(updated);
    setActiveProfileId(profile.id);
    saveActiveProfileId(profile.id);
    setNewProfileName('');
    setIsAddingProfile(false);
  }, [newProfileName, sigilApiUrl, tenantId, prometheusDatasourceUID, tempoDatasourceUID, apiAuthToken, profiles]);

  const handleDeleteProfile = useCallback(
    (profile: ConnectionProfile) => {
      const updated = profiles.filter((p) => p.id !== profile.id);
      setProfiles(updated);
      saveProfiles(updated);
      if (activeProfileId === profile.id) {
        setActiveProfileId(null);
        saveActiveProfileId(null);
      }
      setProfileToDelete(null);
    },
    [profiles, activeProfileId]
  );

  const onSave = async () => {
    setSaving(true);
    setSaveSuccess(false);

    try {
      const pluginData: Partial<PluginMeta<SigilJSONData>> & { secureJsonData?: Record<string, string> } = {
        enabled: plugin.meta.enabled,
        pinned: plugin.meta.pinned,
        jsonData: {
          sigilApiUrl,
          tenantId,
          prometheusDatasourceUID: prometheusDatasourceUID.trim(),
          tempoDatasourceUID: tempoDatasourceUID.trim(),
        },
      };

      const tokenValue = apiAuthToken.trim();
      if (tokenValue.length > 0) {
        pluginData.secureJsonData = { sigilApiAuthToken: tokenValue };
      }

      await updatePlugin(plugin.meta.id, pluginData);
      // Best-effort: the tenant settings endpoint may not exist on all Sigil instances.
      await updateTenantDatasourceSettings(plugin.meta.id, {
        prometheusDatasourceUID: prometheusDatasourceUID.trim(),
        tempoDatasourceUID: tempoDatasourceUID.trim(),
      }).catch(() => { });

      if (activeProfileId) {
        const updated = profiles.map((p) =>
          p.id === activeProfileId
            ? {
              ...p,
              sigilApiUrl,
              tenantId,
              prometheusDatasourceUID: prometheusDatasourceUID.trim(),
              tempoDatasourceUID: tempoDatasourceUID.trim(),
              authToken: tokenValue || p.authToken,
            }
            : p
        );
        setProfiles(updated);
        saveProfiles(updated);
      }

      setSaveSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Profile bar */}
      <div className={styles.profileBar}>
        {profiles.map((p) => {
          const isActive = p.id === activeProfileId;
          return (
            <div key={p.id} className={isActive ? styles.profileChipActive : styles.profileChip}>
              <button
                type="button"
                className={styles.profileChipButton}
                onClick={() => handleSwitchProfile(p.id)}
              >
                {p.name}
              </button>
              <IconButton
                name="times"
                tooltip={`Delete "${p.name}"`}
                size="sm"
                variant="secondary"
                onClick={() => setProfileToDelete(p)}
              />
            </div>
          );
        })}
        <div className={styles.addProfileRow}>
          {isAddingProfile ? (
            <>
              <Input
                width={20}
                autoFocus
                placeholder="Profile name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateProfile();
                  }
                  if (e.key === 'Escape') {
                    setIsAddingProfile(false);
                    setNewProfileName('');
                  }
                }}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!newProfileName.trim()}
                onClick={handleCreateProfile}
              >
                Save
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsAddingProfile(false);
                  setNewProfileName('');
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              tooltip="Save current settings as a named profile"
              onClick={() => setIsAddingProfile(true)}
            >
              Save as profile
            </Button>
          )}
        </div>
      </div>

      {/* Main settings form */}
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
          label="API Auth Token"
          description="Optional. When set, the plugin backend uses HTTP Basic Auth (tenant:token) for Sigil API requests. Stored in browser localStorage per profile."
        >
          <Input
            width={60}
            type="password"
            value={apiAuthToken}
            placeholder="Enter auth token"
            onChange={(e) => setApiAuthToken(e.currentTarget.value)}
          />
        </Field>
        <Field label="Prometheus Datasource" description="Datasource UID used for Prometheus proxy queries via Grafana.">
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

        {saveSuccess && (
          <Alert title="Settings saved" severity="success">
            Configuration saved. The page will reload to apply changes.
          </Alert>
        )}

        <Button onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </FieldSet>

      {profileToDelete && (
        <ConfirmModal
          isOpen
          title={`Delete profile "${profileToDelete.name}"?`}
          body="This only removes the saved profile. It does not change the currently active plugin settings."
          confirmText="Delete"
          onConfirm={() => handleDeleteProfile(profileToDelete)}
          onDismiss={() => setProfileToDelete(null)}
        />
      )}
    </div>
  );
}

function buildDatasourceOptions(
  datasources: GrafanaDatasource[],
  datasourceType: string
): Array<SelectableValue<string>> {
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

const getStyles = (theme: GrafanaTheme2) => {
  const chipBase = css({
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    overflow: 'hidden',
  });

  return {
    container: css({
      maxWidth: 720,
    }),
    profileBar: css({
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(2),
    }),
    profileChip: chipBase,
    profileChipActive: css([
      chipBase,
      {
        borderColor: theme.colors.primary.border,
        background: theme.colors.primary.transparent,
      },
    ]),
    profileChipButton: css({
      all: 'unset',
      cursor: 'pointer',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.primary,
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    addProfileRow: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
  };
};
