import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, Stack, Switch, Text, useStyles2 } from '@grafana/ui';

export type RuleEnableToggleProps = {
  ruleID: string;
  enabled: boolean;
  onToggle: (ruleID: string, enabled: boolean) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
  }),
  left: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    flex: 1,
    minWidth: 0,
  }),
});

export default function RuleEnableToggle({ ruleID, enabled, onToggle }: RuleEnableToggleProps) {
  const styles = useStyles2(getStyles);
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onToggle(ruleID, event.target.checked);
  };

  return (
    <div className={styles.card}>
      <div className={styles.left}>
        <Icon name="power" size="lg" />
        <div>
          <Stack direction="row" gap={1} alignItems="center">
            <Text weight="medium">Enable rule</Text>
            <Badge text={enabled ? 'Active' : 'Disabled'} color={enabled ? 'green' : 'orange'} />
          </Stack>
          <Text variant="bodySmall" color="secondary">
            When enabled, the rule is applied to matching generations.
          </Text>
        </div>
      </div>
      <Switch value={enabled} onChange={handleChange} aria-label={`Toggle rule ${ruleID}`} />
    </div>
  );
}
